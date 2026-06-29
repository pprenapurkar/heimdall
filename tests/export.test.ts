/**
 * X4 — Compliance Evidence Export. The Art. 12 bundle is assembled in SQL and
 * must carry who/what/when/why (verified chain) + findings + cost + per-event
 * hashes, and reflect tamper state honestly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTenant, type SeededTenant } from "./helpers";
import { complianceExport, tamperWithEvent } from "../src/lib/audit";
import { closePool } from "../src/lib/db";

const TENANT = "50000000-0000-0000-0000-0000000000f6";
let ids: SeededTenant["ids"];

beforeAll(async () => {
  ids = (await seedTenant(TENANT)).ids;
});
afterAll(async () => {
  await closePool();
});

describe("compliance export (X4)", () => {
  it("green bundle has who/what/when/why and verifies", async () => {
    const b = (await complianceExport(ids.green, TENANT)) as any;
    expect(b.standard).toMatch(/Article 12/);
    expect(b.who.agent_name).toBe("Refund Concierge");
    expect(b.who.risk_level).toBe("high");
    expect(b.what.allowed_tools).toContain("issue_refund");
    expect(b.when.state).toBe("completed");
    expect(b.why_trustworthy.verified).toBe(true);
    expect(b.why_trustworthy.chain_length).toBe(4);
    expect(b.why_trustworthy.last_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.events).toHaveLength(4);
    expect(b.events[0].current_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.findings).toEqual([]);
  });

  it("red bundle includes findings and cost attribution", async () => {
    const b = (await complianceExport(ids.red, TENANT)) as any;
    expect(b.verdict).toBe("red");
    const types = b.findings.map((f: any) => f.check_type);
    expect(types).toContain("unauthorized_tool");
    expect(types).toContain("semantic_drift");
    expect(b.cost_attribution.wasted_pct).toBeGreaterThan(50);
    expect(b.when.halted_reason).toMatch(/unauthorized tool/);
  });

  it("a tampered run reports verified=false in its bundle", async () => {
    await tamperWithEvent(ids.yellow, 2, TENANT);
    const b = (await complianceExport(ids.yellow, TENANT)) as any;
    expect(b.why_trustworthy.verified).toBe(false);
  });

  it("returns null for an unknown run", async () => {
    const b = await complianceExport("99999999-9999-9999-9999-999999999999", TENANT);
    expect(b).toBeNull();
  });
});
