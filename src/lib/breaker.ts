/**
 * X3 - Circuit breaker. Halt policy is evaluated in SQL (tj_circuit_breaker):
 * any unauthorized tool, over-budget cost, drift above the halt threshold, or
 * too many errors flips the run to 'halted' and records a tamper-evident
 * blocked-action event. Turns the dashboard into a control system.
 */
import "./env";
import { withTenant } from "./db";

const DRIFT_HALT = Number(process.env.CB_DRIFT_SCORE_HALT ?? 0.75);
const MAX_ERRORS = Number(process.env.CB_MAX_ERRORS ?? 3);

/** Evaluate the breaker for a run. Returns the halt reason, or null if not tripped. */
export async function runCircuitBreaker(
  runId: string,
  tenantId: string,
  driftHalt: number = DRIFT_HALT,
  maxErrors: number = MAX_ERRORS
): Promise<string | null> {
  return withTenant(tenantId, async (q) => {
    const res = await q<{ reason: string | null }>(
      `SELECT tj_circuit_breaker($1, $2, $3) AS reason`,
      [runId, driftHalt, maxErrors]
    );
    return res.rows[0]?.reason ?? null;
  });
}
