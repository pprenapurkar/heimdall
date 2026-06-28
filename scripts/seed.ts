/**
 * Seed the three demo fixtures through the real pipeline (ingest -> drift ->
 * breaker). Synthetic data only.
 */
import "../src/lib/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerManifest } from "../src/lib/ingest";
import { processRun } from "../src/lib/pipeline";
import { closePool } from "../src/lib/db";

function load(file: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", file), "utf8"));
}

async function main() {
  const manifest = load("agent.json");
  await registerManifest(manifest.agent, manifest.task);
  console.log(`✓ registered agent "${manifest.agent.name}" + task`);

  for (const file of ["green.json", "yellow.json", "red.json"]) {
    const fixture = load(file);
    const res = await processRun(fixture);
    console.log(
      `✓ ${file.padEnd(12)} -> verdict=${res.verdict}` +
        (res.halted_reason ? `  HALTED: ${res.halted_reason}` : "")
    );
  }
  await closePool();
}

main().catch((e) => {
  console.error("✗ seed failed:", e);
  process.exit(1);
});
