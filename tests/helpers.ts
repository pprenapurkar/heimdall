/**
 * Shared test setup. Tests run against the real Docker Postgres (the DB is the
 * product, so we test the SQL, not a mock). Each suite uses its own tenant id so
 * RLS keeps it isolated from the demo seed and from other suites.
 *
 * Primary keys (agent_id/task_id/run_id) are GLOBALLY unique in the schema - in a
 * real system each belongs to exactly one tenant. The fixtures carry one tenant's
 * canonical IDs, so to safely seed the SAME fixtures under multiple test tenants
 * we namespace those IDs per tenant (deterministically). This avoids PK collisions
 * with the demo seed while keeping runs reproducible.
 */
import "../src/lib/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { registerManifest } from "../src/lib/ingest";
import { processRun, type PipelineResult } from "../src/lib/pipeline";

export function loadFixture(file: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", file), "utf8"));
}

/** Deterministic per-tenant UUID derived from a base id (valid uuid text form). */
export function nsUuid(tenant: string, base: string): string {
  const h = createHash("sha1").update(`${tenant}:${base}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface SeededTenant {
  ids: { green: string; yellow: string; red: string; agent: string; task: string };
  results: Record<string, PipelineResult>;
}

/** Register the manifest and process all three fixtures into a tenant (namespaced IDs). */
export async function seedTenant(tenantId: string): Promise<SeededTenant> {
  const manifest = loadFixture("agent.json");
  const agentId = nsUuid(tenantId, manifest.agent.agent_id);
  const taskId = nsUuid(tenantId, manifest.task.task_id);

  await registerManifest(
    { ...manifest.agent, agent_id: agentId },
    { ...manifest.task, task_id: taskId },
    tenantId
  );

  const ids = { agent: agentId, task: taskId } as SeededTenant["ids"];
  const results: Record<string, PipelineResult> = {};
  for (const [name, file] of [
    ["green", "green.json"],
    ["yellow", "yellow.json"],
    ["red", "red.json"],
  ] as const) {
    const fx = loadFixture(file);
    const runId = nsUuid(tenantId, fx.run_id);
    ids[name] = runId;
    results[name] = await processRun({ ...fx, run_id: runId, task_id: taskId }, tenantId);
  }
  return { ids, results };
}

/** Re-process one fixture under a tenant with the same namespaced ids. */
export async function reprocess(
  tenantId: string,
  file: string
): Promise<PipelineResult> {
  const manifest = loadFixture("agent.json");
  const taskId = nsUuid(tenantId, manifest.task.task_id);
  const fx = loadFixture(file);
  return processRun({ ...fx, run_id: nsUuid(tenantId, fx.run_id), task_id: taskId }, tenantId);
}
