/**
 * C3 - Drift detection. The actual logic lives in SQL (tj_detect_drift in
 * db/schema.sql): deterministic array/relational rules + pgvector `<=>` semantic
 * similarity, rolled into a verdict. This module just invokes it and reads back.
 */
import "./env";
import { withTenant } from "./db";

const THRESHOLD = Number(process.env.SEMANTIC_DRIFT_THRESHOLD ?? 0.45);

export interface DriftCheck {
  check_id: string;
  run_id: string;
  check_type: string;
  severity: "info" | "warn" | "critical";
  evidence_event: string | null;
  score: number | null;
  explanation: string | null;
}

/** Run the SQL drift engine for a run and return the computed verdict. */
export async function detectDrift(
  runId: string,
  tenantId: string,
  threshold: number = THRESHOLD
): Promise<string> {
  return withTenant(tenantId, async (q) => {
    const res = await q<{ verdict: string }>(
      `SELECT tj_detect_drift(CAST($1 AS uuid), CAST($2 AS numeric)) AS verdict`,
      [runId, threshold]
    );
    return res.rows[0].verdict;
  });
}

export async function getDriftChecks(
  runId: string,
  tenantId: string
): Promise<DriftCheck[]> {
  return withTenant(tenantId, async (q) => {
    const res = await q<DriftCheck>(
      `SELECT check_id, run_id, check_type, severity, evidence_event, score, explanation
         FROM drift_checks WHERE run_id = CAST($1 AS uuid)
        ORDER BY severity DESC, check_type`,
      [runId]
    );
    return res.rows;
  });
}
