/**
 * Acceptance harness - proves the pipeline behaves on all three fixtures and
 * that the audit chain detects tampering. Run after `npm run db:reset`.
 *
 *   green  -> verdict green, zero drift
 *   yellow -> verdict yellow, missing_evidence
 *   red    -> verdict red, unauthorized_tool + semantic_drift, breaker halts
 *   tamper -> editing one event makes chain verification fail at that seq
 */
import "../src/lib/env";
import { getDriftChecks } from "../src/lib/drift";
import { listRuns, getRun } from "../src/lib/runs";
import { verifyChain, tamperWithEvent } from "../src/lib/audit";
import { processRun } from "../src/lib/pipeline";
import { closePool } from "../src/lib/db";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TENANT = process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const RUNS = {
  green: "aaaaaaaa-0000-0000-0000-000000000001",
  yellow: "bbbbbbbb-0000-0000-0000-000000000002",
  red: "cccccccc-0000-0000-0000-000000000003",
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  console.log("\n── Verdicts ──────────────────────────────────────────────");
  const runs = await listRuns(TENANT);
  const byId = Object.fromEntries(runs.map((r) => [r.run_id, r]));

  // GREEN
  {
    const r = byId[RUNS.green];
    const drift = await getDriftChecks(RUNS.green, TENANT);
    console.log(`GREEN: verdict=${r?.verdict} drift=${drift.length}`);
    check("green verdict is green", r?.verdict === "green", `(got ${r?.verdict})`);
    check("green has zero drift", drift.length === 0, `(got ${drift.length})`);
  }

  // YELLOW
  {
    const r = byId[RUNS.yellow];
    const drift = await getDriftChecks(RUNS.yellow, TENANT);
    const types = drift.map((d) => d.check_type);
    console.log(`YELLOW: verdict=${r?.verdict} drift=[${types.join(", ")}]`);
    check("yellow verdict is yellow", r?.verdict === "yellow", `(got ${r?.verdict})`);
    check("yellow has missing_evidence", types.includes("missing_evidence"));
    check("yellow has no critical drift", !drift.some((d) => d.severity === "critical"));
  }

  // RED
  {
    const r = byId[RUNS.red];
    const drift = await getDriftChecks(RUNS.red, TENANT);
    const types = drift.map((d) => d.check_type);
    console.log(`RED: verdict=${r?.verdict} state=${r?.state} drift=[${types.join(", ")}]`);
    check("red verdict is red", r?.verdict === "red", `(got ${r?.verdict})`);
    check("red has unauthorized_tool", types.includes("unauthorized_tool"));
    check("red has semantic_drift", types.includes("semantic_drift"));
    check("red run is halted", r?.state === "halted", `(got ${r?.state})`);
    check("red breaker reason set", !!r?.halted_reason, `(got ${r?.halted_reason})`);
  }

  console.log("\n── Cost-after-drift (X1) ─────────────────────────────────");
  {
    const detail = await getRun(RUNS.red, TENANT);
    const c = detail!.cost;
    console.log(
      `RED cost: total=$${c.total_cost} after_drift=$${c.cost_after_drift} (${c.wasted_pct}% wasted, first drift seq ${c.first_drift_seq})`
    );
    check("red attributes cost after drift", c.cost_after_drift > 0);
    check("red wasted_pct > 0", c.wasted_pct > 0);
  }

  console.log("\n── Audit chain integrity (C4) ────────────────────────────");
  {
    const before = await verifyChain(RUNS.green, TENANT);
    console.log(`GREEN chain: verified=${before.verified} length=${before.chain_length}`);
    check("green chain verifies clean", before.verified === true);
    check("green chain length matches events", before.chain_length === 4);

    // Tamper, then re-verify (should fail at the tampered seq).
    await tamperWithEvent(RUNS.green, 2, TENANT);
    const after = await verifyChain(RUNS.green, TENANT);
    console.log(`GREEN chain after tamper: verified=${after.verified} tampered_at=${after.tampered_at}`);
    check("tamper is detected", after.verified === false);
    check("tamper localized to seq 2", after.tampered_at === 2, `(got ${after.tampered_at})`);

    // Restore by re-processing the run so the demo DB is clean again.
    const green = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/green.json"), "utf8"));
    await processRun(green, TENANT);
    const restored = await verifyChain(RUNS.green, TENANT);
    check("chain restored after re-ingest", restored.verified === true);
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(`RESULT: ${pass} passed, ${fail} failed\n`);
  await closePool();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ verify-fixtures crashed:", e);
  process.exit(1);
});
