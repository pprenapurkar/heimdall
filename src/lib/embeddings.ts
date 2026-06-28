/**
 * Embedding provider abstraction.
 *
 * EMBEDDING_PROVIDER selects the backend:
 *   - "local"     : deterministic feature-hashing embeddings. Zero API keys, so
 *                   the entire ingest -> drift pipeline runs offline. Crucially,
 *                   it is *semantic-ish*: texts that share vocabulary land close
 *                   in cosine space, so a refund event stays near a refund goal
 *                   while a competitor-pricing event drifts away. That makes the
 *                   pgvector `<=>` semantic-drift rule meaningful locally.
 *   - "openai"    : text-embedding-3-small via the OpenAI API (needs OPENAI_API_KEY).
 *   - "aurora_ml" : embeddings are NOT computed here — they are generated inside
 *                   Aurora with aws_bedrock.invoke_model_get_embeddings during
 *                   ingest (see src/lib/ingest.ts). This module just reports the
 *                   mode so ingest knows to defer to SQL. "The database performs
 *                   the inference." (CLAUDE.md X2)
 *
 * pgvector here is fixed at 1536 dims to match the schema and OpenAI/Titan.
 */
import "./env";

export type EmbeddingProvider = "local" | "openai" | "aurora_ml";

export function getProvider(): EmbeddingProvider {
  return (process.env.EMBEDDING_PROVIDER as EmbeddingProvider) ?? "local";
}

export function getDim(): number {
  return Number(process.env.EMBEDDING_DIM ?? 1536);
}

/** True when embeddings are produced in-SQL by Aurora ML rather than by the app. */
export function embeddingsComputedInDb(): boolean {
  return getProvider() === "aurora_ml";
}

/**
 * Produce embeddings for the given texts. Returns one vector per input.
 * Throws for the aurora_ml provider: those vectors are produced in SQL, so
 * callers must check embeddingsComputedInDb() first.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const provider = getProvider();
  if (provider === "openai") return embedOpenAI(texts);
  if (provider === "aurora_ml")
    throw new Error(
      "EMBEDDING_PROVIDER=aurora_ml: embeddings are computed in-SQL via aws_bedrock; " +
        "do not call embed() — use the SQL path in ingest.ts."
    );
  return texts.map((t) => featureHashEmbedding(t, getDim()));
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embed([text]))[0];
}

// ---------------------------------------------------------------------------
// Local deterministic feature-hashing embedding.
// ---------------------------------------------------------------------------
// Signed feature hashing (a.k.a. the hashing trick): each token contributes
// +/-1 to a bucket chosen by a hash of the token. Shared tokens -> shared
// buckets -> higher cosine similarity. The result is L2-normalized so cosine
// distance via pgvector `<=>` is well-behaved.
export function featureHashEmbedding(text: string, dim: number): number[] {
  const vec = new Float64Array(dim);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const h1 = fnv1a(tok);
    const h2 = fnv1a("salt:" + tok);
    const idx = h1 % dim;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = vec[i] / norm;
  return out;
}

// Stopwords are dropped so topical content (refund/order/policy vs.
// competitor/pricing/market) dominates the cosine signal for short texts.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at",
  "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "into", "per", "within",
  "has", "have", "had", "do", "does", "did", "will", "would", "should", "can",
  "could", "may", "might", "must", "shall", "not", "no", "so", "up", "out",
  "if", "then", "than", "there", "here", "all", "any", "each", "more", "most",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// 32-bit FNV-1a, returned as an unsigned integer.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// OpenAI provider (gated behind EMBEDDING_PROVIDER=openai).
// ---------------------------------------------------------------------------
async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is unset");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

/** Format a JS number[] as a pgvector literal: "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
