/**
 * DB-usage proof: prints the SQL evidence that Aurora/Postgres is doing the work
 * (JSONB, relational joins, pgvector <=>, hash chain, window/FILTER). Screenshot
 * this output (or the equivalent in psql) for the submission deliverable.
 */
import "../src/lib/env";
import { withTenant, closePool } from "../src/lib/db";

const TENANT = process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

async function main() {
  await withTenant(TENANT, async (q) => {
    const hr = (s: string) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 56 - s.length))}`);

    hr("Verdicts (relational join: runs ⋈ tasks ⋈ agents)");
    const v = await q(
      `SELECT a.name AS agent, r.label, r.verdict, r.state, r.halted_reason
         FROM agent_runs r JOIN tasks t ON t.task_id=r.task_id
         JOIN agents a ON a.agent_id=t.agent_id ORDER BY r.started_at`
    );
    console.table(v.rows);

    hr("Drift findings (SQL rules + pgvector cosine distance)");
    const d = await q(
      `SELECT substr(run_id::text,1,4) AS run, check_type, severity, round(score,3) AS distance
         FROM drift_checks ORDER BY run_id, severity DESC, check_type`
    );
    console.table(d.rows);

    hr("Semantic drift via pgvector <=> (task.goal vs event)");
    const s = await q(
      `SELECT te.seq, te.tool_name,
              round((te.event_embedding <=> t.goal_embedding)::numeric,3) AS cosine_distance
         FROM trace_events te
         JOIN agent_runs r ON r.run_id=te.run_id
         JOIN tasks t ON t.task_id=r.task_id
        WHERE r.label='Rogue refund agent' AND te.event_embedding IS NOT NULL
        ORDER BY te.seq`
    );
    console.table(s.rows);

    hr("Tamper-evident hash chain (pgcrypto sha256, recursive verify)");
    const c = await q(
      `SELECT seq, ok, substr(stored_hash,1,16)||'…' AS stored_hash
         FROM tj_verify_chain(
           (SELECT run_id FROM agent_runs WHERE label='Compliant refund'))
        ORDER BY seq`
    );
    console.table(c.rows);

    hr("Cost-after-drift (X1: window / FILTER aggregation)");
    const x = await q(
      `SELECT * FROM tj_cost_after_drift(
         (SELECT run_id FROM agent_runs WHERE label='Rogue refund agent'))`
    );
    console.table(x.rows);

    hr("JSONB span payload (raw_event) sample");
    const j = await q(
      `SELECT seq, raw_event FROM trace_events
        WHERE run_id=(SELECT run_id FROM agent_runs WHERE label='Rogue refund agent')
        ORDER BY seq LIMIT 3`
    );
    console.table(j.rows.map((r) => ({ seq: (r as any).seq, raw_event: JSON.stringify((r as any).raw_event) })));
  });
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
