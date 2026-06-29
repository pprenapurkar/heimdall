/**
 * Coverage for the policy/control-plane features beyond the core verdict path:
 *   C1  - RLS tenant isolation (one tenant cannot see another's runs)
 *   X1  - cost-after-drift attribution
 *   X3  - circuit breaker halts + records a tamper-evident blocked event
 *   C3  - prohibited_action / prohibited_data rules fire on the red run
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTenant, type SeededTenant } from "./helpers";
import { listRuns, getRun } from "../src/lib/runs";
import { getDriftChecks } from "../src/lib/drift";
import { verifyChain } from "../src/lib/audit";
import { withTenant, closePool } from "../src/lib/db";

const TENANT_A = "30000000-0000-0000-0000-0000000000a1";
const TENANT_B = "30000000-0000-0000-0000-0000000000b2";
let a: SeededTenant["ids"];

beforeAll(async () => {
  a = (await seedTenant(TENANT_A)).ids;
  // TENANT_B intentionally left empty to test isolation.
});
afterAll(async () => {
  await closePool();
});

describe("RLS tenant isolation (C1)", () => {
  it("tenant A sees its three runs", async () => {
    const runs = await listRuns(TENANT_A);
    expect(runs.length).toBe(3);
  });

  it("tenant B (empty) sees nothing from tenant A", async () => {
    const runs = await listRuns(TENANT_B);
    expect(runs.length).toBe(0);
  });

  it("tenant B cannot read tenant A's run by id", async () => {
    const detail = await getRun(a.red, TENANT_B);
    expect(detail).toBeNull();
  });

  it("RLS blocks even a direct cross-tenant SELECT", async () => {
    const rows = await withTenant(TENANT_B, async (q) => {
      const res = await q<{ n: number }>(`SELECT count(*)::int AS n FROM trace_events`);
      return res.rows[0];
    });
    expect(rows.n).toBe(0);
  });
});

describe("cost-after-drift (X1)", () => {
  it("attributes the majority of red's spend to after the first drift", async () => {
    const detail = await getRun(a.red, TENANT_A);
    const c = detail!.cost;
    expect(c.first_drift_seq).toBe(3);
    expect(c.cost_after_drift).toBeGreaterThan(c.cost_before_drift);
    expect(c.wasted_pct).toBeGreaterThan(50);
    expect(Number((c.cost_before_drift + c.cost_after_drift).toFixed(4))).toBeCloseTo(
      c.total_cost,
      4
    );
  });

  it("green has no drift, so no post-drift cost", async () => {
    const detail = await getRun(a.green, TENANT_A);
    expect(detail!.cost.first_drift_seq).toBeNull();
    expect(detail!.cost.cost_after_drift).toBe(0);
  });
});

describe("circuit breaker (X3)", () => {
  it("halts the red run and records a reason", async () => {
    const run = (await listRuns(TENANT_A)).find((r) => r.run_id === a.red);
    expect(run?.state).toBe("halted");
    expect(run?.halted_reason).toMatch(/unauthorized tool/);
  });

  it("writes a tamper-evident circuit_breaker_halt event into the chain", async () => {
    const detail = await getRun(a.red, TENANT_A);
    const halt = detail!.timeline.find((e) => e.event_type === "circuit_breaker_halt");
    expect(halt).toBeTruthy();
    const audit = await verifyChain(a.red, TENANT_A);
    expect(audit.verified).toBe(true);
    expect(audit.rows.some((r) => r.seq === halt!.seq)).toBe(true);
  });

  it("does not halt the green or yellow runs", async () => {
    const runs = await listRuns(TENANT_A);
    expect(runs.find((r) => r.run_id === a.green)?.state).toBe("completed");
    expect(runs.find((r) => r.run_id === a.yellow)?.state).toBe("completed");
  });
});

describe("prohibited rules (C3)", () => {
  it("red flags both a prohibited action and prohibited data", async () => {
    const drift = await getDriftChecks(a.red, TENANT_A);
    const types = drift.map((d) => d.check_type);
    expect(types).toContain("prohibited_action");
    expect(types).toContain("prohibited_data");
  });

  it("the prohibited_data finding points at the competitor pricing output", async () => {
    const drift = await getDriftChecks(a.red, TENANT_A);
    const pd = drift.find((d) => d.check_type === "prohibited_data");
    expect(pd?.explanation?.toLowerCase()).toContain("competitor");
  });
});
