/**
 * C4 - Tamper-evident audit chain verification. The chain is built and verified
 * in SQL (tj_append_to_chain / tj_verify_chain). The DB is the integrity source
 * of truth - this module surfaces the verify result and a demo tamper helper.
 */
import "./env";
import { withTenant } from "./db";

export interface ChainRow {
  seq: number;
  event_id: string;
  stored_hash: string;
  recomputed_hash: string;
  ok: boolean;
}

export interface VerifyResult {
  verified: boolean;
  chain_length: number;
  last_hash: string | null;
  tampered_at: number | null; // seq of first mismatch, or null
  rows: ChainRow[];
}

/** Recompute the whole chain in SQL and report verified / length / last / tamper. */
export async function verifyChain(
  runId: string,
  tenantId: string
): Promise<VerifyResult> {
  return withTenant(tenantId, async (q) => {
    const res = await q<ChainRow>(
      `SELECT seq, event_id, stored_hash, recomputed_hash, ok
         FROM tj_verify_chain($1) ORDER BY seq`,
      [runId]
    );
    const rows = res.rows.map((r) => ({ ...r, ok: r.ok === true || (r.ok as unknown) === "t" }));
    const firstBad = rows.find((r) => !r.ok);
    return {
      verified: rows.length > 0 && rows.every((r) => r.ok),
      chain_length: rows.length,
      last_hash: rows.length ? rows[rows.length - 1].stored_hash : null,
      tampered_at: firstBad ? firstBad.seq : null,
      rows,
    };
  });
}

/**
 * X4 - Compliance Evidence Export. Assemble the EU AI Act Article 12 audit bundle
 * in SQL (tj_compliance_export): who/what/when/why + findings + cost + per-event
 * hashes. Returned as a JSONB document the app streams to the regulator as-is.
 */
export async function complianceExport(
  runId: string,
  tenantId: string
): Promise<Record<string, unknown> | null> {
  return withTenant(tenantId, async (q) => {
    const res = await q<{ bundle: Record<string, unknown> }>(
      `SELECT tj_compliance_export($1) AS bundle`,
      [runId]
    );
    return res.rows[0]?.bundle ?? null;
  });
}

/**
 * DEMO HELPER (C4 proof): mutate one event's output_text WITHOUT recomputing its
 * stored hash. Re-running verifyChain() must then report tampered_at = that seq.
 * This is how the demo proves the record can't be silently altered.
 */
export async function tamperWithEvent(
  runId: string,
  seq: number,
  tenantId: string,
  newText = "[REDACTED BY INSIDER]"
): Promise<void> {
  await withTenant(tenantId, async (q) => {
    await q(
      `UPDATE trace_events SET output_text = $3
         WHERE run_id = $1 AND seq = $2`,
      [runId, seq, newText]
    );
  });
}
