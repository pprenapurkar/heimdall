/**
 * Shared test setup. Tests run against the real Docker Postgres (the DB is the
 * product, so we test the SQL, not a mock). Each suite uses its own tenant id so
 * RLS keeps it isolated from the demo seed and from other suites.
 */
import "../src/lib/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerManifest } from "../src/lib/ingest";
import { processRun, type PipelineResult } from "../src/lib/pipeline";

export function loadFixture(file: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", file), "utf8"));
}

export const RUN_IDS = {
  green: "aaaaaaaa-0000-0000-0000-000000000001",
  yellow: "bbbbbbbb-0000-0000-0000-000000000002",
  red: "cccccccc-0000-0000-0000-000000000003",
};

/** Register the manifest and process all three fixtures into a tenant. */
export async function seedTenant(
  tenantId: string
): Promise<Record<string, PipelineResult>> {
  const manifest = loadFixture("agent.json");
  await registerManifest(manifest.agent, manifest.task, tenantId);
  const out: Record<string, PipelineResult> = {};
  for (const [name, file] of [
    ["green", "green.json"],
    ["yellow", "yellow.json"],
    ["red", "red.json"],
  ] as const) {
    out[name] = await processRun(loadFixture(file), tenantId);
  }
  return out;
}
