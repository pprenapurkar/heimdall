# How I built TraceJudge: using Aurora PostgreSQL as the brain, not the bucket

*This is my build write-up for the H0 hackathon. I made TraceJudge as my entry. Stack is Amazon Aurora PostgreSQL plus a Next.js frontend on Vercel. #H0Hackathon*

I kept coming back to one question while watching teams ship AI agents into real workflows: after an agent finishes a task, can you actually prove what it did? Most setups can't. The logs are just rows in a table that anyone with write access can edit. There's no judgment about whether the agent stayed inside its lane, and there's no way to show a record wasn't tampered with after the fact.

That bothered me enough to build something for it.

## What it does

TraceJudge is a flight recorder for agents. You register what an agent is allowed to do (its goal, the tools it may call, the steps it must take, the actions and data that are off limits, its budget). Then you feed it the trace of what the agent actually did. It decides whether the agent drifted, and it writes a verdict you can trust because the whole record is hash-chained and verifiable.

I picked the B2B angle because this is most urgent for regulated teams. The EU AI Act's Article 12 becomes enforceable on August 2, 2026, and it requires high-risk AI systems to keep automatic, tamper-evident logs. Ordinary application logging does not meet that bar. The fines go up to 15 million euros or 3 percent of global turnover, so this is not a nice-to-have for the companies it applies to.

## The decision that shaped everything

I made one rule for myself early on: if a feature could be done just as well with a JSON file and some app code, I was doing it wrong. The database had to be the thing doing the real work. So Aurora PostgreSQL is not storage sitting behind an API in this project. It is the trace store, the policy engine, the judge, and the audit ledger. The TypeScript app mostly ships SQL and renders what comes back.

That sounds like a slogan, so here is what it actually means in the code.

## Where the database does the hard part

**Policy as data, with real row-level security.** The agent's declared intent lives in plain relational tables. Each tenant table has an RLS policy keyed on a per-transaction setting, with FORCE turned on. I hit a good lesson here: Postgres superusers ignore RLS even with FORCE, and the local Docker user is a superuser, so my first isolation test passed when it should have failed. The fix was to have each tenant transaction drop to a non-superuser role before running queries. After that, an empty tenant genuinely sees zero rows, which my tests now check.

**One trace table that is both flexible and queryable.** Every event keeps the full span as JSONB and the important fields (model, tokens, cost) as typed columns aligned to the OpenTelemetry GenAI conventions. So I get a flexible document store and a fast relational timeline from the same table.

**Drift detection in a single SQL function.** This runs the deterministic checks (a tool that was not allowed, a required step that never happened, a banned action or data category) alongside a semantic check using pgvector cosine distance between the task goal and each event. The array checks use `= ANY(...)` rather than `NOT IN`, and the similarity uses the `<=>` operator. It all rolls up into a green, yellow, or red verdict in the same query path.

**A hash chain that the database verifies itself.** On insert, each event's hash is sha256 of the previous hash concatenated with a canonical form of the event, computed with pgcrypto. Verification is a recursive CTE that recomputes the entire chain and compares it to what's stored. If anyone edits a single byte of any event, the recomputed hash stops matching at exactly that step. In the demo I prove it live: a button silently edits one event, the audit badge flips to "tamper detected" at that step, and a reset restores a clean chain.

**Cost attribution with a window function.** One aggregation with a FILTER clause splits the run's spend into before and after the first drift. On my red run that comes out to about 88 percent of the money spent after the agent had already gone off track, which is a much better story than just saying "it drifted."

**A circuit breaker as a SQL state machine.** If a run uses an unauthorized tool, blows its budget, drifts badly, or errors too often, a function halts the run and writes the blocked action into the hash chain too, so even the intervention is part of the auditable record.

**A compliance export built in SQL.** One function assembles the whole Article 12 bundle as a single JSON document: who the agent was, what it was allowed to do, when it ran, why the record can be trusted (the verified chain), plus findings, cost, and per-event hashes. A regulator could recompute the chain independently.

## A couple of engineering notes

I wanted the project to run end to end with no API keys so anyone could clone it and see the real pipeline, not a mock. For that I wrote a deterministic local embedding using feature hashing, so text that shares vocabulary lands close in cosine space. A refund event stays near a refund goal while a competitor-pricing event drifts away. The real providers (OpenAI, and Aurora's own in-SQL Bedrock calls) sit behind an environment flag. One honest caveat: lexical hashing shifts the cosine scale, so the local threshold is tuned higher than the value I use with real embeddings. The score is always a real cosine distance; only the cutoff tracks the provider.

For talking to Aurora from Vercel I used the RDS Data API instead of a normal connection pool, since serverless functions and pooled Postgres connections do not get along. Auth comes through Vercel's AWS OIDC integration, so there are no AWS keys anywhere in the repo.

And because I believe the database is the product, my tests run against a real Postgres in isolated tenants rather than against mocks. There are 35 of them covering the drift rules, the hash chain and tamper detection, RLS isolation, cost attribution, the breaker, and the export.

## The demo

Three seeded refund-agent runs tell the whole story:

- Green: reads the order, retrieves the policy as evidence, refunds within the limit. Clean.
- Yellow: refunds but skips the evidence step, so it gets flagged for missing evidence.
- Red: calls an unauthorized competitor-pricing tool, writes an unsupported note to memory, and tries an over-limit refund. It comes back red with an unauthorized-tool and a semantic-drift finding, the breaker halts it, and the cost panel shows how much was wasted after it went wrong.

Then I tamper with an event and the chain catches it at the exact step.

## What I would build next

Memory governance for what an agent reads and writes, replaying a past run under a stricter policy using Aurora's fast clone, and ingesting live traces from real LangChain or CrewAI agents instead of fixtures.

## Takeaway

The thing I came away with is that Postgres did the reasoning, the policy enforcement, and the integrity proof, and the app stayed thin. If you are building agent infrastructure, your database can probably carry more of the load than you are giving it.

Built for the H0 hackathon using Amazon Aurora PostgreSQL and Vercel. #H0Hackathon
