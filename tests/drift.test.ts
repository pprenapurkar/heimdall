/**
 * C3 — Drift Detection Engine. Verifies the SQL rules + pgvector semantic drift
 * produce the right findings and verdict roll-up on the three fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTenant, RUN_IDS } from "./helpers";
import { getDriftChecks } from "../src/lib/drift";
import { listRuns } from "../src/lib/runs";
import { closePool } from "../src/lib/db";

const TENANT = "10000000-0000-0000-0000-0000000000d1";

beforeAll(async () => {
  await seedTenant(TENANT);
});
afterAll(async () => {
  await closePool();
});

describe("drift engine (C3)", () => {
  it("GREEN run is clean and verdict is green", async () => {
    const drift = await getDriftChecks(RUN_IDS.green, TENANT);
    expect(drift).toHaveLength(0);
    const run = (await listRuns(TENANT)).find((r) => r.run_id === RUN_IDS.green);
    expect(run?.verdict).toBe("green");
  });

  it("YELLOW run flags missing_evidence and verdict is yellow", async () => {
    const drift = await getDriftChecks(RUN_IDS.yellow, TENANT);
    const types = drift.map((d) => d.check_type);
    expect(types).toContain("missing_evidence");
    expect(drift.some((d) => d.severity === "critical")).toBe(false);
    const run = (await listRuns(TENANT)).find((r) => r.run_id === RUN_IDS.yellow);
    expect(run?.verdict).toBe("yellow");
  });

  it("RED run flags unauthorized_tool AND semantic_drift, verdict red", async () => {
    const drift = await getDriftChecks(RUN_IDS.red, TENANT);
    const types = drift.map((d) => d.check_type);
    expect(types).toContain("unauthorized_tool");
    expect(types).toContain("semantic_drift");
    const run = (await listRuns(TENANT)).find((r) => r.run_id === RUN_IDS.red);
    expect(run?.verdict).toBe("red");
  });

  it("RED unauthorized tool is the competitor pricing lookup", async () => {
    const drift = await getDriftChecks(RUN_IDS.red, TENANT);
    const unauth = drift.find((d) => d.check_type === "unauthorized_tool");
    expect(unauth?.explanation).toContain("competitor_pricing_lookup");
  });

  it("semantic drift only fires on off-task events (not the green refund)", async () => {
    const green = await getDriftChecks(RUN_IDS.green, TENANT);
    expect(green.some((d) => d.check_type === "semantic_drift")).toBe(false);
    const red = await getDriftChecks(RUN_IDS.red, TENANT);
    const sem = red.find((d) => d.check_type === "semantic_drift");
    expect(Number(sem?.score)).toBeGreaterThan(0.45);
  });
});
