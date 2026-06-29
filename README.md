# Heimdall

**Heimdall Protocol: A Flight Recorder for Autonomous AI Agents**

Heimdall is a database-native flight recorder for autonomous AI agents. You register what an agent was allowed to do, feed it the trace of what the agent actually did, and it decides whether the agent drifted and writes a tamper-evident verdict you can trust.

The core idea: Aurora PostgreSQL is not storage behind an app here. It is the trace store, the policy engine, the semantic judge, and the audit ledger. The app layer mostly ships SQL and renders the result.

Why it matters: ordinary application logs are mutable and can't prove they weren't altered. The EU AI Act Article 12 (enforceable Aug 2, 2026) requires high-risk AI systems to keep automatic, traceable, tamper-evident records, with penalties up to 15M euros or 3% of global turnover. Heimdall closes that gap, and it does the hard part in the database.

## Why the database is the product

Every feature is built so Postgres visibly does the work rather than the app layer:

| Capability | Where it lives | DB strength |
|---|---|---|
| Declared intent / policy-as-data | `agents`, `tasks` tables + RLS | relational schema, row-level security |
| Trace store (OTel GenAI-aligned) | `trace_events` (typed cols + JSONB) | JSONB + relational joins |
| Drift detection | `tj_detect_drift()` SQL function | `= ANY()` rules + pgvector `<=>` |
| Tamper-evident chain | `tj_append_to_chain()` / `tj_verify_chain()` | pgcrypto sha256 + recursive CTE |
| Cost-after-drift | `tj_cost_after_drift()` | window / `FILTER` aggregation |
| Circuit breaker | `tj_circuit_breaker()` | state machine in SQL |
| Compliance export | `tj_compliance_export()` | JSONB assembly in SQL |
| In-SQL inference (prod) | `aws_bedrock.invoke_model*` | Aurora ML |

## Architecture

```mermaid
flowchart TD
  subgraph Vercel["Vercel - Next.js (frontend + API routes)"]
    UI["Verdict dashboard (C5)"]
    API["ingest / runs / verify / tamper / export"]
  end

  subgraph Aurora["Aurora PostgreSQL - the control plane"]
    direction TB
    TS["trace_events<br/>JSONB + typed gen_ai.* cols"]
    POL["agents / tasks<br/>policy-as-data + RLS"]
    DRIFT["tj_detect_drift()<br/>SQL rules + pgvector &lt;=&gt;"]
    CHAIN["audit_chain<br/>sha256 hash chain (pgcrypto)"]
    CB["tj_circuit_breaker()<br/>halt policy state machine"]
  end

  Bedrock["Amazon Bedrock<br/>embeddings + explanations"]
  FIX["Seeded JSON fixtures<br/>(green / yellow / red runs)"]

  FIX -->|"POST /api/ingest"| API
  UI <-->|"RDS Data API (connection-free)"| Aurora
  API <-->|"RDS Data API"| Aurora
  POL --> DRIFT
  TS --> DRIFT
  TS --> CHAIN
  DRIFT --> CB
  DRIFT -. "EMBEDDING_PROVIDER=aurora_ml (in-SQL inference, X2)" .-> Bedrock

  classDef db fill:#1b2231,stroke:#4aa3ff,color:#e6e9ef;
  class TS,POL,DRIFT,CHAIN,CB db;
```

The trace source is seeded JSON fixtures; the pipeline that processes them (ingest, score, hash, verdict) is fully real. Locally, Aurora is stood in by `pgvector/pgvector:pg16` (Postgres 16 plus pgvector, feature compatible) reached with the plain `pg` driver. In production the same SQL runs on Aurora over the RDS Data API (connection-free and serverless-safe), authenticated via Vercel Marketplace OIDC, so there are no AWS keys in the repo.

## Feature map (CLAUDE.md)

- C1 Agent Registry and Manifest: declared intent stored relationally, multi-tenant via RLS.
- C2 Trace Event Store: ordered OTel GenAI events; full span as JSONB plus typed columns.
- C3 Drift Detection Engine: deterministic rules plus pgvector semantic drift, in one SQL function.
- C4 Tamper-Evident Audit Chain: `sha256(prev || canonical(event))`, verified via a recursive CTE.
- C5 Verdict Dashboard: runs list (R/Y/G), timeline with the drift point highlighted, audit-verified badge.
- X1 Cost-After-Drift: `SUM(cost) FILTER (WHERE seq >= first_drift)`.
- X2 Aurora ML In-SQL: embeddings and explanations from `aws_bedrock.*` (flag-gated; external fallback kept).
- X3 Circuit Breaker: halt on unauthorized tool, over budget, severe drift, or errors; the block is itself chained.
- X4 Compliance Evidence Export: EU AI Act Art. 12 audit bundle (who/what/when/why plus verified hashes) assembled in SQL, downloadable per run.

## Quickstart (local, zero API keys)

Requires Docker and Node 20.

```bash
cp .env.example .env.local      # defaults: DB_MODE=local, EMBEDDING_PROVIDER=local
npm install
npm run db:up                   # start pgvector/pgvector:pg16 on :5433
npm run db:schema               # apply db/schema.sql (idempotent)
npm run db:seed                 # ingest the 3 fixtures through the real pipeline

npm run verify:fixtures         # acceptance harness (expect 17/17)
npm test                        # integration tests against the real DB (expect 35 passing)

npm run dev                     # dashboard at http://localhost:3000
```

`npm run db:reset` runs nuke, up, schema, and seed in one shot.

## The three demo runs

| Run | What the agent did | Verdict | Findings |
|---|---|---|---|
| green | reads the order, retrieves policy evidence, refunds within limit | green | none |
| yellow | refunds but skips evidence retrieval | yellow | `missing_evidence` |
| red | calls an unauthorized competitor-pricing tool, writes unsupported memory, attempts an over-limit refund | red | `unauthorized_tool` + `semantic_drift` (plus prohibited_action/data); circuit breaker halts; about 88% of spend wasted after drift |

On any run, the Tamper button silently edits an event and the audit badge flips to "tamper detected" at that exact step; Reset restores a verifiable chain.

## Embeddings and thresholds

`EMBEDDING_PROVIDER` is `local` (default), `openai`, or `aurora_ml`. The local provider uses deterministic signed feature-hashing so the semantic-drift rule works offline. Because lexical hashing shifts the cosine scale, `SEMANTIC_DRIFT_THRESHOLD` is 0.80 for local and 0.45 for real embeddings (see `DECISIONS.md` D4).

## Deploy and submit

- `SUBMISSION.md` is the ordered runbook to deploy and submit to the H0 hackathon (every Devpost deliverable, video beats, Team ID, screenshots, write-up).
- `DEPLOY.md` is the infra detail: provisioning Aurora Serverless v2 (Terraform in `terraform/`), enabling the Data API and Aurora ML, applying the schema, and deploying the frontend on Vercel with OIDC.

## Deliverables checklist

- [x] Working app (local) via `npm run dev`
- [x] Architecture diagram (Mermaid, above)
- [x] DB-usage proof via `npm run db:proof` (prints the SQL evidence), then screenshot
- [x] Public repo (this repository)
- [ ] Vercel deploy plus Team ID (operator step, see SUBMISSION.md)
- [ ] Demo video under 3 minutes (script in CLAUDE.md section 10)
- [ ] #H0Hackathon write-up (draft in `WRITEUP.md`)

## Future scope (designed for, not in the MVP)

Memory governance, replay under a stricter policy via Aurora fast-clone, live OTel ingestion from real LangChain or CrewAI agents, a DynamoDB telemetry firehose, and multi-region via Aurora DSQL.

## Project layout

```
db/schema.sql         schema plus all SQL functions (the engine)
fixtures/*.json       synthetic green/yellow/red runs plus manifest
src/lib/              db seam, embeddings, ingest, drift, audit, breaker, runs
src/app/              Next.js dashboard plus API routes
scripts/              apply-schema, seed, verify-fixtures, db-proof
tests/                drift, hash chain, policy, ingest, export tests (real DB)
terraform/            Aurora Serverless v2, Data API, Secrets
```
