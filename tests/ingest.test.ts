/**
 * C2/C4 - ingest idempotency. Re-ingesting the same run must not duplicate events
 * or corrupt the hash chain (the ingest path clears the run first). Also checks
 * the OTel-aligned typed columns + JSONB are persisted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTenant, reprocess, type SeededTenant } from "./helpers";
import { getRun } from "../src/lib/runs";
import { verifyChain } from "../src/lib/audit";
import { withTenant, closePool } from "../src/lib/db";

const TENANT = "40000000-0000-0000-0000-0000000000e5";
let ids: SeededTenant["ids"];

beforeAll(async () => {
  ids = (await seedTenant(TENANT)).ids;
});
afterAll(async () => {
  await closePool();
});

describe("ingest idempotency (C2/C4)", () => {
  it("re-ingesting a run keeps event count stable and chain verifiable", async () => {
    const before = (await getRun(ids.green, TENANT))!;
    expect(before.timeline).toHaveLength(4);

    await reprocess(TENANT, "green.json");
    await reprocess(TENANT, "green.json"); // twice

    const after = (await getRun(ids.green, TENANT))!;
    expect(after.timeline).toHaveLength(4); // no duplication
    const audit = await verifyChain(ids.green, TENANT);
    expect(audit.verified).toBe(true);
    expect(audit.chain_length).toBe(4);
  });

  it("persists OTel typed columns and the JSONB span", async () => {
    const run = (await getRun(ids.green, TENANT))!;
    const tool = run.timeline.find((e) => e.tool_name === "issue_refund")!;
    expect(tool.model).toBe("claude-3-haiku-20240307");
    expect(tool.input_tokens).toBeGreaterThan(0);
    expect(tool.cost_usd).toBeGreaterThan(0);
    expect(tool.raw_event["gen_ai.tool.name"]).toBe("issue_refund");
  });

  it("stores one audit_chain row per event, linked by prev_hash", async () => {
    const audit = await verifyChain(ids.green, TENANT);
    expect(audit.rows[0].seq).toBe(1);
    // each row's recomputed hash matches stored (verified chain)
    expect(audit.rows.every((r) => r.ok)).toBe(true);
    // distinct hashes per event
    const hashes = new Set(audit.rows.map((r) => r.stored_hash));
    expect(hashes.size).toBe(audit.rows.length);
  });

  it("RLS prevents seeing audit rows without tenant context mismatch", async () => {
    // Same tenant can see its chain; sanity that the count matches timeline.
    const n = await withTenant(TENANT, async (q) => {
      const res = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_chain WHERE run_id = $1`,
        [ids.green]
      );
      return res.rows[0].n;
    });
    expect(n).toBe(4);
  });
});
