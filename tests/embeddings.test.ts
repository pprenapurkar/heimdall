/**
 * Unit tests for the embedding provider (no DB). Locks in the properties the
 * semantic-drift rule depends on: determinism, dimensionality, normalization,
 * and that on-task text is closer to the goal than off-task text (the basis for
 * the calibrated threshold in DECISIONS.md D4).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  featureHashEmbedding,
  embed,
  embedOne,
  getDim,
  toVectorLiteral,
} from "../src/lib/embeddings";

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot; // inputs are L2-normalized
}

const GOAL =
  "Process the customer refund request: verify the order, check the refund policy, issue a refund within the approved limit.";
const ON_TASK = "Refund of $40 issued to the customer for the order per the refund policy limit.";
const OFF_TASK =
  "Competitor pricing analysis: rival retailer lists the SKU at $150, market discounting this quarter.";

describe("feature-hashing embeddings", () => {
  afterEach(() => {
    delete process.env.EMBEDDING_PROVIDER;
  });

  it("is deterministic for the same text", () => {
    const a = featureHashEmbedding(GOAL, 1536);
    const b = featureHashEmbedding(GOAL, 1536);
    expect(a).toEqual(b);
  });

  it("produces vectors of the configured dimension", () => {
    expect(featureHashEmbedding(GOAL, 1536)).toHaveLength(1536);
    expect(getDim()).toBe(1536);
  });

  it("returns L2-normalized vectors", () => {
    const v = featureHashEmbedding(ON_TASK, 1536);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("places on-task text closer to the goal than off-task text", () => {
    const g = featureHashEmbedding(GOAL, 1536);
    const onDist = cosineDistance(g, featureHashEmbedding(ON_TASK, 1536));
    const offDist = cosineDistance(g, featureHashEmbedding(OFF_TASK, 1536));
    expect(onDist).toBeLessThan(offDist);
    // Matches the local calibration: on-task below 0.80, off-task above.
    expect(onDist).toBeLessThan(0.8);
    expect(offDist).toBeGreaterThan(0.8);
  });

  it("embed() (local) returns one vector per input", async () => {
    const out = await embed([GOAL, ON_TASK]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1536);
    const one = await embedOne(OFF_TASK);
    expect(one).toHaveLength(1536);
  });

  it("aurora_ml provider refuses app-side embedding (in-SQL only)", async () => {
    process.env.EMBEDDING_PROVIDER = "aurora_ml";
    await expect(embed([GOAL])).rejects.toThrow(/aurora_ml/);
  });

  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([0.1, -0.2, 0.3])).toBe("[0.1,-0.2,0.3]");
  });
});
