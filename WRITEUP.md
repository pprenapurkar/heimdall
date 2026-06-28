# Building TraceJudge: using Aurora PostgreSQL as an AI-agent control plane #H0Hackathon

*Draft build write-up. Publish on a public platform (dev.to / Hashnode / LinkedIn /
Medium) tagged **#H0Hackathon**. Add your demo video + live URL before posting.*

---

## The problem nobody can answer yet

We're shipping AI agents into refunds, claims, IT, and finance — workflows where a
wrong action costs money or breaks a law. But ask the obvious question after an agent
run — *"did it do what it was allowed to do, and can you prove the record wasn't
edited?"* — and most stacks can't answer. App logs are mutable. A screenshot isn't
evidence.

This isn't hypothetical. The **EU AI Act, Article 12** (enforceable Aug 2, 2026)
requires high-risk AI systems to keep automatic, traceable, **tamper-evident**
records. Penalties run to €15M / 3% of global turnover. Standard logging doesn't
satisfy it.

## The idea: make the database the judge

TraceJudge is a **flight recorder for agents**. It registers what an agent was
*allowed* to do, ingests what it *actually* did, decides whether it **drifted**, and
writes a **tamper-evident** verdict.

The bet that shaped every decision:

> Don't use Aurora PostgreSQL as storage behind an app. Use it as the **control
> plane** — trace store, semantic judge, policy engine, and audit ledger.

If a feature could be done just as well with a JSON file or a generic ORM call, it was
built wrong. So the hard parts live in SQL.

## How the database does the hard part

**1. Policy-as-data + Row-Level Security.** Declared intent (allowed tools, required
steps, prohibited actions, budget) is relational data in `agents`/`tasks`. Every table
has an RLS policy keyed on a per-transaction `app.tenant_id` GUC, with
`FORCE ROW LEVEL SECURITY` so isolation applies even to the table owner — real
multi-tenancy enforced by the database, not by hopeful `WHERE` clauses.

**2. Trace store: JSONB + typed columns, OTel-aligned.** Each event keeps the full
span as `jsonb` *and* typed `gen_ai.*` columns (model, tokens, cost). One table is
both a flexible document store and a queryable relational timeline.

**3. Drift detection in one SQL function.** `tj_detect_drift()` runs five rule
families and rolls up a verdict:

- `unauthorized_tool` via array membership — `NOT (tool = ANY(allowed_tools))`
  (never `NOT IN` on an array).
- `prohibited_action` / `prohibited_data` matched against policy arrays / output text.
- `missing_evidence` via `NOT EXISTS` on the required step.
- `semantic_drift` via **pgvector** cosine distance — `event_embedding <=> goal_embedding`.

Deterministic policy rules and vector similarity, evaluated in the same query plan.

**4. A tamper-evident hash chain — verified in SQL.** On insert,
`current_hash = sha256(prev_hash || canonical(event))` using `pgcrypto`. Verification
is a **recursive CTE** that recomputes the whole chain and compares to stored hashes.
Edit any byte of any event and the recomputed hash diverges at exactly that step. The
demo proves it live: a "Tamper" button silently edits an event, the audit badge flips
to **Tamper detected at seq N**, and "Reset" restores a verifiable chain.

**5. Cost-after-drift, in one window aggregation.**
`SUM(cost) FILTER (WHERE seq >= first_drift)` turns "it drifted" into "**87.5% of the
spend happened *after* it drifted.**"

**6. A circuit breaker that's a SQL state machine.** `tj_circuit_breaker()` halts a run
on an unauthorized tool, over-budget cost, severe drift, or repeated errors — and writes
the *blocked action itself* into the hash chain, so even the intervention is auditable.

## Engineering choices worth calling out

- **Connection-free Aurora.** The Vercel app talks to Aurora over the **RDS Data API**,
  so serverless scale-to-zero never exhausts a PG connection pool. AWS auth comes from
  **Vercel Marketplace OIDC** — zero credentials in the repo.
- **Runs 100% offline for development.** A deterministic **feature-hashing embedding**
  provider makes the pgvector semantic-drift path work with no API keys, so the entire
  ingest → score → hash → verdict pipeline is real even locally. Real embeddings
  (OpenAI, or **Aurora ML calling Bedrock from inside SQL**) sit behind an env flag.
- **The DB is what we test.** Integration tests run against real Postgres in isolated
  RLS tenants — we test the SQL, because the SQL *is* the product. 9/9 tests + a
  17/17 acceptance harness green on the three demo runs.

## The demo in 20 seconds

Three seeded refund-agent runs:
- 🟢 **green** — reads the order, retrieves policy evidence, refunds within limit. Clean.
- 🟡 **yellow** — refunds but skips evidence retrieval → `missing_evidence`.
- 🔴 **red** — calls an unauthorized competitor-pricing tool, writes unsupported memory,
  attempts an over-limit refund → `unauthorized_tool` + `semantic_drift`, **breaker
  halts**, **87.5% of spend wasted after drift**.

Then: tamper an event → the chain catches it at the exact step.

## What's next

Memory governance, replay of a past run under stricter policy via **Aurora fast-clone**,
live OTel ingestion from real LangChain/CrewAI agents, and multi-region via Aurora DSQL.

## Takeaway

Postgres did the reasoning, the policy enforcement, and the integrity proof. The app is
a thin renderer. If you're building agent infrastructure, your database is more capable
than you're letting it be.

*Built for the H0 Hackathon. Stack: Aurora PostgreSQL (pgvector, pgcrypto, RLS, RDS
Data API, Aurora ML) + Next.js on Vercel.* **#H0Hackathon**
