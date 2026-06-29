/**
 * Database access layer.
 *
 * TraceJudge's thesis is "the database is the product", so the app holds almost
 * no business logic - it ships SQL to Postgres and renders the result. This
 * module is the single seam between the app and the DB.
 *
 * Two backends, selected by DB_MODE:
 *   - "local"    : plain `pg` driver against the Docker pgvector container.
 *   - "data-api" : AWS RDS Data API against Aurora PostgreSQL (serverless-safe,
 *                  connection-free). This is the production path on Vercel; auth
 *                  flows in via Vercel Marketplace OIDC, so no AWS keys are needed
 *                  in the repo. See `queryDataApi` below for the swap point.
 *
 * Multi-tenancy: Row-Level Security keys off the per-transaction GUC
 * `app.tenant_id`. Always go through `withTenant()` for tenant-scoped work so the
 * GUC is set inside the same transaction as the query.
 */
import "./env";
import { Pool, type PoolClient } from "pg";

export type SqlParam = string | number | boolean | null | Array<unknown>;
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

const DB_MODE = process.env.DB_MODE ?? "local";

// ---------------------------------------------------------------------------
// Local backend: plain pg Pool.
// ---------------------------------------------------------------------------
let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgres://tracejudge:tracejudge@localhost:5433/tracejudge",
      max: 5,
    });
  }
  return pool;
}

/** Admin-style query with no tenant context. Use only for DDL / cross-tenant ops. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: SqlParam[] = []
): Promise<QueryResult<T>> {
  if (DB_MODE === "data-api") return queryDataApi<T>(text, params);
  const res = await getPool().query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

/**
 * Run `fn` inside a transaction with RLS tenant context set. Every query issued
 * through the provided `q` runs as that tenant, so RLS enforces isolation at the
 * database - not in app code.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (q: TenantQuery) => Promise<T>
): Promise<T> {
  if (DB_MODE === "data-api") return withTenantDataApi(tenantId, fn);

  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Drop to the non-superuser app role so RLS is actually enforced (superusers
    // bypass RLS). SET LOCAL is reverted on COMMIT/ROLLBACK.
    await client.query("SET LOCAL ROLE tracejudge_app");
    // set_config(..., true) => scoped to this transaction only.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const q: TenantQuery = async (text, params = []) => {
      const res = await client.query(text, params);
      return { rows: res.rows as never[], rowCount: res.rowCount ?? 0 };
    };
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export type TenantQuery = <T = Record<string, unknown>>(
  text: string,
  params?: SqlParam[]
) => Promise<QueryResult<T>>;

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---------------------------------------------------------------------------
// Production backend: AWS RDS Data API against Aurora PostgreSQL.
// ---------------------------------------------------------------------------
// Connection-free: each call is an HTTPS request, so it survives serverless
// scale-to-zero without exhausting a PG connection pool. The Data API speaks
// the same SQL as the local path, so the SQL strings above are unchanged - only
// parameter marshalling differs. Tenant context is set with the same
// set_config() call, batched into the same transaction via transactionId.
//
// This path is intentionally not exercised locally (no Aurora). It is wired and
// ready for the Vercel + Aurora deploy described in DEPLOY.md.
async function getDataApiClient() {
  const { RDSDataClient } = await import("@aws-sdk/client-rds-data");
  return new RDSDataClient({ region: process.env.AWS_REGION ?? "us-east-1" });
}

function toDataApiParams(params: SqlParam[]) {
  // Convert positional $1..$n SQL to Data API named params :p1..:pn happens in
  // queryDataApi; here we only box JS values into Data API SqlParameter shapes.
  return params.map((v, i) => {
    const name = `p${i + 1}`;
    if (v === null) return { name, value: { isNull: true } };
    if (typeof v === "number")
      return Number.isInteger(v)
        ? { name, value: { longValue: v } }
        : { name, value: { doubleValue: v } };
    if (typeof v === "boolean") return { name, value: { booleanValue: v } };
    if (Array.isArray(v))
      // Postgres arrays / vectors are sent as text and cast in-SQL.
      return { name, value: { stringValue: JSON.stringify(v) } };
    return { name, value: { stringValue: String(v) } };
  });
}

async function queryDataApi<T>(
  text: string,
  params: SqlParam[],
  transactionId?: string
): Promise<QueryResult<T>> {
  const { ExecuteStatementCommand } = await import("@aws-sdk/client-rds-data");
  const client = await getDataApiClient();
  // Rewrite $1..$n -> :p1..:pn for the Data API.
  const sql = text.replace(/\$(\d+)/g, (_, n) => `:p${n}`);
  const res = await client.send(
    new ExecuteStatementCommand({
      resourceArn: process.env.AURORA_CLUSTER_ARN,
      secretArn: process.env.AURORA_SECRET_ARN,
      database: process.env.AURORA_DATABASE ?? "tracejudge",
      sql,
      parameters: toDataApiParams(params),
      includeResultMetadata: true,
      transactionId,
    })
  );
  const cols = (res.columnMetadata ?? []).map((c) => c.name ?? "");
  const rows = (res.records ?? []).map((rec) => {
    const obj: Record<string, unknown> = {};
    rec.forEach((field, i) => {
      obj[cols[i]] = unwrapField(field as unknown as Record<string, unknown>);
    });
    return obj as T;
  });
  return { rows, rowCount: res.numberOfRecordsUpdated ?? rows.length };
}

function unwrapField(f: Record<string, unknown>): unknown {
  if (f.isNull) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("longValue" in f) return f.longValue;
  if ("doubleValue" in f) return f.doubleValue;
  if ("booleanValue" in f) return f.booleanValue;
  return null;
}

async function withTenantDataApi<T>(
  tenantId: string,
  fn: (q: TenantQuery) => Promise<T>
): Promise<T> {
  const { BeginTransactionCommand, CommitTransactionCommand, RollbackTransactionCommand } =
    await import("@aws-sdk/client-rds-data");
  const client = await getDataApiClient();
  const begin = await client.send(
    new BeginTransactionCommand({
      resourceArn: process.env.AURORA_CLUSTER_ARN,
      secretArn: process.env.AURORA_SECRET_ARN,
      database: process.env.AURORA_DATABASE ?? "tracejudge",
    })
  );
  const txId = begin.transactionId!;
  try {
    // Drop to the non-superuser app role so RLS is enforced (see local path).
    await queryDataApi("SET LOCAL ROLE tracejudge_app", [], txId);
    await queryDataApi("SELECT set_config('app.tenant_id', $1, true)", [tenantId], txId);
    const q: TenantQuery = (text, params = []) => queryDataApi(text, params, txId);
    const out = await fn(q);
    await client.send(
      new CommitTransactionCommand({
        resourceArn: process.env.AURORA_CLUSTER_ARN,
        secretArn: process.env.AURORA_SECRET_ARN,
        transactionId: txId,
      })
    );
    return out;
  } catch (e) {
    await client.send(
      new RollbackTransactionCommand({
        resourceArn: process.env.AURORA_CLUSTER_ARN,
        secretArn: process.env.AURORA_SECRET_ARN,
        transactionId: txId,
      })
    );
    throw e;
  }
}
