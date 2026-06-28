/**
 * C4 — Tamper-Evident Audit Chain. Verifies the SQL hash chain is consistent,
 * detects mutation of any event, localizes the tamper, and recovers on re-ingest.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTenant, RUN_IDS, loadFixture } from "./helpers";
import { verifyChain, tamperWithEvent } from "../src/lib/audit";
import { processRun } from "../src/lib/pipeline";
import { closePool } from "../src/lib/db";

const TENANT = "20000000-0000-0000-0000-0000000000c4";

beforeAll(async () => {
  await seedTenant(TENANT);
});
afterAll(async () => {
  await closePool();
});

describe("audit chain (C4)", () => {
  it("a clean run verifies and chain length equals event count", async () => {
    const res = await verifyChain(RUN_IDS.green, TENANT);
    expect(res.verified).toBe(true);
    expect(res.chain_length).toBe(4);
    expect(res.last_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("each hash is sha256-shaped and links to the previous", async () => {
    const res = await verifyChain(RUN_IDS.yellow, TENANT);
    for (const row of res.rows) {
      expect(row.stored_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.ok).toBe(true);
    }
  });

  it("mutating an event is detected and localized to its seq", async () => {
    await tamperWithEvent(RUN_IDS.green, 2, TENANT);
    const res = await verifyChain(RUN_IDS.green, TENANT);
    expect(res.verified).toBe(false);
    expect(res.tampered_at).toBe(2);
  });

  it("re-ingesting the run restores a verifiable chain", async () => {
    await processRun(loadFixture("green.json"), TENANT);
    const res = await verifyChain(RUN_IDS.green, TENANT);
    expect(res.verified).toBe(true);
    expect(res.tampered_at).toBeNull();
  });
});
