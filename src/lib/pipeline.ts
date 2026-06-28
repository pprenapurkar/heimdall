/**
 * End-to-end pipeline for one run: ingest -> drift -> circuit breaker -> finalize.
 * Used by the ingest API route and the seed script so the "live" path and the
 * demo path are identical.
 */
import "./env";
import { ingestRun, type RunFixture } from "./ingest";
import { detectDrift } from "./drift";
import { runCircuitBreaker } from "./breaker";
import { withTenant } from "./db";

const DEFAULT_TENANT =
  process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

export interface PipelineResult {
  run_id: string;
  events: number;
  verdict: string;
  halted_reason: string | null;
}

export async function processRun(
  fixture: RunFixture,
  tenantId: string = DEFAULT_TENANT
): Promise<PipelineResult> {
  const { run_id, events } = await ingestRun(fixture, tenantId);
  const verdict = await detectDrift(run_id, tenantId);
  const halted_reason = await runCircuitBreaker(run_id, tenantId);

  // Finalize state: halted breaker wins; otherwise the run completed.
  await withTenant(tenantId, async (q) => {
    await q(
      `UPDATE agent_runs SET state = CASE WHEN state = 'halted' THEN 'halted' ELSE 'completed' END
        WHERE run_id = $1`,
      [run_id]
    );
  });

  return { run_id, events, verdict, halted_reason };
}
