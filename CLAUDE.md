# CLAUDE.md — TraceJudge

> Build brief for Claude Code. This file is the single source of truth. Read the
> "READ FIRST" section before writing any code, and re-read it whenever a decision
> feels ambiguous. Reference features by their ID (e.g. "C3", "X1") instead of
> re-describing them.

---

## ⭐ READ FIRST — THE NORTH STAR (do not drift from this)

**TraceJudge is a database-native flight recorder for AI agents.** It registers what
an agent was *allowed* to do, ingests what it *actually* did, decides whether it
**drifted**, and writes a **tamper-evident** verdict.

**The product IS the database. Aurora PostgreSQL is not storage behind an app — it is
the reasoning engine, the policy engine, and the audit ledger.**

### The one invariant every feature must satisfy
> If a feature could be done just as well with a plain JSON file or a generic ORM call,
> we are building it wrong. Each feature must make Aurora PostgreSQL *visibly do the
> hard part*: relational joins, JSONB, pgvector similarity, SQL rules, window
> functions, hash-chain integrity, or Aurora ML in-SQL inference.

### The winning sentence (anchor the whole submission to this)
> "We are not using Aurora PostgreSQL as storage. We are using it as the agent control
> plane: trace store, semantic judge, policy engine, and audit ledger."

### Anti-drift guardrails for the build
- Do **not** wander into building a generic observability dashboard. The differentiator
  is **judgment + tamper-evidence**, not pretty logs.
- Do **not** instrument a live agent. The trace **source** is seeded JSON fixtures.
  The pipeline (ingest → score → hash → verdict) is 100% real; only the input is canned.
- Do **not** let any AI/LLM call become the centerpiece. The LLM is a helper; the
  database does the deciding.
- When in doubt, push logic **into SQL**, not into the TypeScript app layer.

---

## 1. What we're building

- **Name:** TraceJudge
- **Track:** Monetizable B2B (buyer: any team deploying AI agents in regulated/
  high-stakes workflows — support, insurance, finance, healthcare ops, IT).
- **One-liner:** An Aurora PostgreSQL–powered audit layer that proves whether an AI
  agent did what it was assigned to do — and lets you trust the record.
- **Deadline:** June 29, 2026, 5:00 PM PT (7:00 PM CDT). Hard stop.
- **Why it matters (Impact):** EU AI Act Article 12 (enforceable Aug 2, 2026) requires
  high-risk AI systems to keep automatic, traceable, tamper-evident records; standard
  app logs are mutable and can't prove they weren't altered. TraceJudge closes that gap.
  Penalties reach €15M / 3% of global turnover.

## 2. Hard constraints (submission is invalid without these)

- **Primary backend MUST be Aurora PostgreSQL.** (Aurora is the system of record AND
  the reasoning store.)
- **Frontend MUST be deployed on Vercel or v0.app.**
- Demo video **< 3 minutes**.
- Required deliverables: working app link, **architecture diagram**, **DB-usage proof
  screenshot**, **public repo**, **Vercel Team ID**.
- Bonus (do not skip): a short build write-up on a public platform tagged
  **#H0Hackathon** (worth up to +0.6 on a 1–5.6 scale — likely decisive).

## 3. Architecture

```
Vercel (Next.js frontend + API routes)
        │
        │  RDS Data API  (connection-free; do NOT use a raw PG pool from serverless)
        ▼
Aurora PostgreSQL  ── pgvector, JSONB, SQL rules, hash chain, window functions
        │
        │  (Extension X2) Aurora ML in-SQL
        ▼
Amazon Bedrock  (embeddings + drift explanations, called FROM SQL)

Trace source: seeded JSON fixtures (3 runs) → ingestion endpoint → pipeline above.
```

- **Connection:** use the **RDS Data API** for Vercel→Aurora (serverless-friendly,
  no connection-pool footgun).
- **Auth:** use **Vercel Marketplace OIDC** for AWS — no AWS keys committed to the repo.
- **Multi-tenancy:** every table carries `tenant_id`; enable **Row-Level Security (RLS)**
  if smooth, else enforce `tenant_id` in every query (RLS is the stronger DB signal).

## 4. Data model (Aurora PostgreSQL)

Trace schema is aligned to the **OpenTelemetry GenAI semantic conventions** (`gen_ai.*`)
so it reads as intentional and could ingest real LangChain/CrewAI spans later.

```sql
CREATE EXTENSION IF NOT EXISTS vector;        -- pgvector

-- WHO/WHAT the agent is allowed to do (declared intent)
CREATE TABLE agents (
  agent_id       uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  name           text NOT NULL,
  owner          text NOT NULL,
  risk_level     text NOT NULL,                -- low|medium|high
  policy_version int  NOT NULL DEFAULT 1
);

CREATE TABLE tasks (
  task_id              uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  agent_id             uuid NOT NULL REFERENCES agents(agent_id),
  assigned_goal        text NOT NULL,
  allowed_tools        text[] NOT NULL,
  required_steps       text[] NOT NULL,        -- e.g. {evidence_retrieved}
  prohibited_actions   text[] NOT NULL,
  prohibited_data      text[] NOT NULL DEFAULT '{}',
  max_budget_usd       numeric(10,4) NOT NULL DEFAULT 1.00,
  goal_embedding       vector(1536)            -- task intent embedding
);

CREATE TABLE agent_runs (
  run_id        uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  task_id       uuid NOT NULL REFERENCES tasks(task_id),
  state         text NOT NULL DEFAULT 'running', -- running|completed|halted
  started_at    timestamptz NOT NULL DEFAULT now(),
  verdict       text                              -- green|yellow|red (computed)
);

-- WHAT the agent actually did (OTel GenAI-aligned)
CREATE TABLE trace_events (
  event_id        uuid PRIMARY KEY,
  run_id          uuid NOT NULL REFERENCES agent_runs(run_id),
  tenant_id       uuid NOT NULL,
  seq             int  NOT NULL,                 -- ordering within a run
  event_type      text NOT NULL,                 -- invoke_agent|execute_tool|chat|
                                                 -- memory_read|memory_write|evidence_retrieved
  tool_name       text,                          -- gen_ai.tool.name
  model           text,                          -- gen_ai.request.model
  input_tokens    int,                           -- gen_ai.usage.input_tokens
  output_tokens   int,                           -- gen_ai.usage.output_tokens
  cost_usd        numeric(10,4) DEFAULT 0,
  output_text     text,
  raw_event       jsonb NOT NULL,                -- full span payload (JSONB)
  event_embedding vector(1536),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON trace_events (run_id, seq);
CREATE INDEX ON trace_events USING hnsw (event_embedding vector_cosine_ops);

-- WHY we trust it (tamper-evident)
CREATE TABLE audit_chain (
  event_id      uuid PRIMARY KEY REFERENCES trace_events(event_id),
  run_id        uuid NOT NULL,
  prev_hash     text,
  current_hash  text NOT NULL                    -- sha256(prev_hash || canonical(payload))
);

-- DRIFT findings
CREATE TABLE drift_checks (
  check_id        uuid PRIMARY KEY,
  run_id          uuid NOT NULL,
  check_type      text NOT NULL,                 -- unauthorized_tool|missing_step|
                                                 -- prohibited_action|missing_evidence|semantic_drift
  severity        text NOT NULL,                 -- info|warn|critical
  evidence_event  uuid,
  score           numeric,
  explanation     text
);
```

---

## 5. PHASE 1 — CORE (must ship; this alone is a valid, competitive submission)

Build these five. Each names the DB strength it must visibly demonstrate.

**C1 — Agent Registry & Manifest.**
Store declared intent (goal, allowed tools, required steps, prohibited actions/data,
budget, owner, risk, policy_version) relationally. Multi-tenant.
*DB strength:* relational schema + policy-as-data + RLS.
*Done when:* you can register an agent+task and see it constrain later scoring.

**C2 — Trace Event Store (OTel GenAI-aligned).**
Ingest a run as ordered events; store full span as JSONB **and** typed columns mapped to
`gen_ai.*`. Indexed timeline per run.
*DB strength:* JSONB + relational joins + standards-aligned schema.
*Done when:* posting a fixture creates ordered, queryable events with token/cost columns.

**C3 — Drift Detection Engine (hybrid, in SQL).**
Deterministic rules + semantic similarity, computed in SQL:
- `unauthorized_tool`: tool not in allowed list →
  `NOT (e.tool_name = ANY(t.allowed_tools))`  *(use ANY(), never `NOT IN` on arrays)*
- `missing_step` / `missing_evidence`: required step absent →
  `NOT EXISTS (SELECT 1 FROM trace_events te WHERE te.run_id=r.run_id AND te.event_type='evidence_retrieved')`
- `prohibited_action` / prohibited data scope: matched against task arrays
- `semantic_drift`: pgvector cosine distance between `tasks.goal_embedding` and the
  event/output embedding using the `<=>` operator, threshold ~0.45
Roll per-event findings into a run `verdict` (green/yellow/red).
*DB strength:* pgvector + SQL rules engine.
*Done when:* the red fixture yields unauthorized_tool + semantic_drift; green yields none.

**C4 — Tamper-Evident Audit Chain.**
On each event insert, compute `current_hash = sha256(prev_hash || canonical_json(payload))`.
Expose a **verify** endpoint that recomputes the whole chain and reports
verified / chain length / last hash / tamper-detected. Demonstrate tamper detection by
mutating one row and re-verifying.
*DB strength:* the DB is the integrity source of truth (EU AI Act Art. 12 anchor).
*Done when:* editing any event makes verification fail loudly.

**C5 — Verdict Dashboard (Vercel).**
Runs list with R/Y/G; click a run → trace timeline with the **drift point highlighted**,
drill-down to the offending event + its evidence, and an **"audit verified"** badge.
*DB strength:* presentation over DB-computed verdicts; live updates via Postgres
LISTEN/NOTIFY or light polling.
*Done when:* the three fixtures render as green/yellow/red with a clear "drifted at step N".

---

## 6. PHASE 2 — EXTENSION (competitive edge; build only after ALL Core is green)

Ordered by ROI. Stop wherever the clock says stop.

**X1 — Cost-After-Drift Attribution.** (highest demo ROI, ~1 SQL query)
Show total run cost vs. cost incurred **after** the first drift event:
`SUM(cost_usd) FILTER (WHERE created_at >= first_drift_time)`.
Pitch line: "We don't just say it drifted — we show how much money was spent after it did."
*DB strength:* window functions / FILTER.

**X2 — Aurora ML In-SQL (the headline technical flex).**
Replace external embedding calls with `aws_bedrock.invoke_model_get_embeddings` and
generate natural-language drift explanations with `aws_bedrock.invoke_model` — **inside
SQL**. "The database itself performs the inference."
*DB strength:* Aurora ML. *Keep the external-AI path as fallback (see §9).*

**X3 — Circuit Breaker.**
Rules: halt run if `unauthorized_tool >= 1` OR `cost > max_budget_usd` OR
`drift_score > 0.75` OR `errors >= 3`. Flip `agent_runs.state = 'halted'`, record the
**blocked action into the audit chain**.
*DB strength:* state machine + policy evaluation in the DB. Turns a dashboard into a
control system.

**X4 (only if time) — Compliance Evidence Export.**
Generate an Art. 12 audit bundle from the hash chain: who/what/when/why + verification
hashes, exportable for a regulator. Cheap because it's a report over data you already have.

---

## 7. FUTURE SCOPE — say it, don't build it

Mention these in the README/video as "designed for, not in MVP." They protect the
originality narrative without risking the build:
- Memory governance (memory_read/write/blocked events + consent policy)
- Replay & **Aurora fast-clone** sandbox: re-evaluate a past run under stricter policy
- Live OTel ingestion from real LangChain/CrewAI agents (replacing seeded fixtures)
- "DynamoFire" companion: DynamoDB Streams+TTL telemetry firehose for all-runs-at-scale
- eBPF/syscall runtime observability (intent↔action correlation)
- Multi-region active-active via Aurora DSQL

---

## 8. BUILD ORDER (protects a working submission from the clock)

1. Repo + Next.js on Vercel + Aurora cluster up + schema applied + RDS Data API wired.
2. **C2** ingest of one fixture → **C4** hash chain → **C1** registry → **C3**
   deterministic rules → **C5** dashboard. *(You now have a complete submittable app
   even if nothing else lands.)*
3. **C3** semantic drift using **external embeddings (OpenAI) first** (allowed).
4. Seed all three fixtures; record verdicts correctly.
5. **X1** cost-after-drift.
6. **X2** swap embeddings/explanations to Aurora ML in-SQL (the flex). Never let this
   block the build.
7. **X3** circuit breaker; **X4** if time remains.
8. Architecture diagram, DB-proof screenshot, < 3-min video, #H0Hackathon write-up.

## 9. FALLBACK LEVERS (if behind — cut in this order)

1. Drop **X4 → X3 → X2** (keep external embeddings; Aurora stays system of record).
2. Reduce fixtures from 3 to 2 (keep green + red).
3. Replace LISTEN/NOTIFY with simple polling.
4. Swap RLS for `tenant_id` filters.
**Never cut:** C1–C5 or the tamper-evident chain — that's the whole thesis.

## 10. DEMO SCRIPT (the 3 seeded runs + video beats)

Fixtures (refund-agent scenario):
- **Green:** reads order → reads refund policy → issues refund ≤ limit. No drift.
- **Yellow:** issues refund but **skips** the required evidence-retrieval step.
- **Red:** calls an **unauthorized** competitor-pricing tool, attempts an **over-limit**
  refund, writes an unsupported memory entry. → unauthorized_tool + semantic_drift
  + (X3) circuit-breaker halt.

Video (≤ 3:00):
- 0:00–0:25 Problem (agents act unsupervised; you can't prove what they did).
- 0:25–1:20 App: show green, yellow, red runs.
- 1:20–2:10 **Database reveal**: timeline, drift point, and "this is computed in Aurora —
  JSONB traces, pgvector similarity, SQL rules, and a hash chain — not just logs."
- 2:10–2:40 Architecture (Vercel → RDS Data API → Aurora → Aurora ML/Bedrock).
- 2:40–3:00 Impact (EU AI Act Art. 12; trustworthy flight recorder before production).

## 11. GOTCHAS (the panel reads the code)

- pgvector cosine distance uses the `<=>` operator; index with `hnsw (... vector_cosine_ops)`.
- Array membership: `tool_name = ANY(allowed_tools)`, **not** `NOT IN`.
- Use RDS Data API from Vercel; a raw PG pool from serverless functions will exhaust
  connections.
- Aurora ML needs an IAM role + Bedrock model access + VPC networking — budget time and
  keep the external-AI fallback ready (rules allow external AI as long as Aurora is the
  primary backend and system of record).
- Use **synthetic data only**. No real PII/PHI anywhere in the repo or video.
- Keep AWS auth via OIDC; commit zero credentials.

## 12. Reference sources (for verification, not copying)

- OTel GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- Aurora ML (Bedrock from SQL): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/postgresql-ml.html
- Aurora as Bedrock KB / pgvector: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.VectorDB.html
- Aurora fast cloning: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Clone.html
- EU AI Act Article 12: https://artificialintelligenceact.eu/article/12/
