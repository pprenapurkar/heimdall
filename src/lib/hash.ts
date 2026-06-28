/**
 * Hashing helpers.
 *
 * NOTE: the authoritative hash chain is computed and verified INSIDE Postgres
 * (tj_append_to_chain / tj_verify_chain in db/schema.sql) — the database is the
 * integrity source of truth, per CLAUDE.md C4. These TS helpers exist only as a
 * cross-check / reference and for any app-side canonicalization needs. The
 * canonical form here mirrors tj_canonical_event() so an external auditor could
 * independently recompute the chain.
 */
import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Deterministic JSON with recursively sorted keys (matches jsonb key ordering intent). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
