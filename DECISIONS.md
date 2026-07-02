# Decisions Log

Decision logs help you understand why a decision was taken and the context behind it for future ref. Reference CLAUDE.md feature IDs.

## D1 - Local Postgres stands in for Aurora
`pgvector/pgvector:pg16` via Docker. Aurora PostgreSQL is Postgres-16 + pgvector
compatible, so `db/schema.sql` and every query transfer 1:1. Host port is **5433**
to avoid clashing with a local 5432.

## D2 - Two DB backends behind one seam (`src/lib/db.ts`)
`DB_MODE=local` uses the plain `pg` driver; `DB_MODE=data-api` uses the AWS RDS
Data API against Aurora (connection-free, serverless-safe). The Data API path is
fully written but not exercised locally. SQL strings are identical; only param
marshalling and `$n`→`:pn` rewriting differ.

## D3 - Deterministic local embeddings (the key enabler for offline runs)
`EMBEDDING_PROVIDER=local` uses **signed feature hashing** (the hashing trick) with
stopword removal. It needs zero API keys yet is *semantic-ish*: shared vocabulary
→ shared buckets → higher cosine similarity. So a refund event stays near a refund
goal while a competitor-pricing event drifts away, making the pgvector `<=>` rule
meaningful offline. Real providers (`openai`, `aurora_ml`) are gated behind the flag.

## D4 - Semantic-drift threshold is provider-calibrated
Lexical feature-hashing compresses/shifts the cosine scale: on-task events land at
~0.70 distance, off-task at ~0.90+. The spec's 0.45 is correct for *real* embeddings
(OpenAI/Titan: on-task ~0.25, off-task ~0.55+). So `SEMANTIC_DRIFT_THRESHOLD`
defaults to **0.80 for local** and **0.45 for openai/aurora_ml**. The drift *score*
(raw cosine distance) is always real; only the threshold tracks the provider scale.
Same logic for `CB_DRIFT_SCORE_HALT` (0.90 local / 0.75 real).

## D5 - Hash chain + verification live in SQL (C4)
`tj_append_to_chain` computes `sha256(prev_hash || canonical(event))` with pgcrypto;
`tj_verify_chain` recomputes the entire chain with a recursive CTE and compares to
stored hashes. The DB is the integrity source of truth, not app code. Canonical form
uses `jsonb::text` (deterministic key order) plus the typed columns.

## D6 - Drift engine is one SQL function (C3)
`tj_detect_drift` runs all five rule families (unauthorized_tool, prohibited_action,
prohibited_data, missing_step/missing_evidence, semantic_drift) and rolls up the
verdict. Array membership uses `= ANY(...)`, never `NOT IN`. pgvector `<=>` for
cosine distance. Logic stays in SQL per the North Star.

## D7 - Row-Level Security with FORCE + a non-superuser app role (C1)
Every tenant table has an RLS policy keyed on `current_setting('app.tenant_id')`,
and `FORCE ROW LEVEL SECURITY` so it applies even to the table owner. **Important
gotcha discovered during testing:** Postgres superusers (and `BYPASSRLS` roles)
ignore RLS entirely, even with FORCE - and the local Docker user *is* a superuser
(as is the Aurora master to a degree). So `withTenant()` does
`SET LOCAL ROLE tracejudge_app` (a `NOLOGIN`, non-superuser role created in the
schema) per transaction before setting the GUC. This makes isolation genuinely
enforced on both local and Aurora, verified by `tests/policy.test.ts` (an empty
tenant sees 0 rows; cross-tenant reads return null). Stronger DB signal than the
plain `tenant_id` filter fallback (CLAUDE.md §9).

Note: PKs (`agent_id`/`task_id`/`run_id`) are globally unique (one tenant each in
reality). Tests namespace fixture IDs per tenant (`tests/helpers.ts nsUuid`) to seed
the same fixtures under multiple tenants without PK collisions.

## D8 - Over-limit refund is modeled as data, not a dedicated rule
The red fixture's $500 refund carries `raw_event.over_limit=true` and the narrative
text, but there is no separate "refund exceeds limit" SQL rule (no approved-refund-
limit column in the schema). The red run is already unambiguously red via
unauthorized_tool + prohibited_action + prohibited_data + semantic_drift, and the
circuit breaker halts it. Adding a refund-limit column/rule is noted as easy future
scope. This keeps the schema aligned to CLAUDE.md §4 without bloat.

## D9 - Tests run against the real DB, in isolated tenants
The product *is* the database, so tests exercise the real SQL (not mocks). Each
suite uses its own `tenant_id`, so RLS isolates them from the demo seed and from
each other. Requires `npm run db:up` first.

## D10 - No external attribution in commits/repo
Per the operator's instruction, commits are plain conventional-commit messages
authored as the user; no AI attribution anywhere.
