# SUMMARY — TraceJudge build status

**Status: complete and verified locally.** Every Phase-1 Core feature (C1–C5) and the
high-ROI Phase-2 extensions (X1 cost-after-drift, X3 circuit breaker) are built,
runnable, and tested against a real Postgres. X2 (Aurora ML in-SQL) is written and
flag-gated for the Aurora deploy. The North Star holds: the hard logic lives in SQL —
the app is a thin renderer.

## What works (run it yourself)

```bash
cp .env.example .env.local
npm install
npm run db:reset          # docker pgvector up, schema applied, 3 fixtures seeded
npm run verify:fixtures   # 17/17 acceptance checks
npm test                  # 20/20 integration tests (3 suites)
npm run db:proof          # SQL evidence for the DB-usage screenshot
npm run dev               # dashboard at http://localhost:3000
npm run build             # production build succeeds (Vercel-ready)
```

### Feature status

| ID | Feature | State | Where |
|----|---------|-------|-------|
| C1 | Agent registry + manifest, multi-tenant | ✅ | `agents`/`tasks` + RLS, `ingest.ts` |
| C2 | OTel-aligned trace store (JSONB + typed) | ✅ | `trace_events`, `ingest.ts` |
| C3 | Drift engine (rules + pgvector) | ✅ | `tj_detect_drift()`, `drift.ts` |
| C4 | Tamper-evident hash chain | ✅ | `tj_append_to_chain`/`tj_verify_chain`, `audit.ts` |
| C5 | Verdict dashboard | ✅ | `src/app/**` |
| X1 | Cost-after-drift | ✅ | `tj_cost_after_drift()` |
| X2 | Aurora ML in-SQL embeddings/explanations | ✍️ written, flag-gated (needs Aurora) | `ingest.ts` (`aurora_ml`) |
| X3 | Circuit breaker | ✅ | `tj_circuit_breaker()`, `breaker.ts` |
| X4 | Compliance evidence export (Art. 12) | ✅ | `tj_compliance_export()`, `audit.ts`, `/api/runs/[id]/export` |

### Verified behavior on the 3 fixtures
- 🟢 **green** → verdict green, 0 drift, chain verifies (len 4).
- 🟡 **yellow** → verdict yellow, `missing_evidence`.
- 🔴 **red** → verdict red, `unauthorized_tool` + `semantic_drift` (+ prohibited_action/
  data), circuit breaker **halts**, **87.5% of spend wasted after drift**.
- **Tamper proof**: editing any event makes `tj_verify_chain` fail at that exact seq;
  re-ingest restores it.
- **RLS**: an empty tenant sees 0 rows; cross-tenant reads return null (genuinely
  enforced via a non-superuser role — see DECISIONS.md D7).

## How the database does the hard part (the thesis)
- Policy-as-data + **RLS** (FORCE + app role) for multi-tenancy.
- **JSONB** full spans alongside typed `gen_ai.*` columns + relational joins.
- **pgvector** `<=>` cosine distance for semantic drift; `= ANY()` array rules.
- **pgcrypto** sha256 hash chain verified by a **recursive CTE**.
- **window / FILTER** aggregation for cost-after-drift.
- Drift, verdict, breaker, and verification are all **SQL functions**.

## What's left for you (operator)
1. **Provision Aurora** (`terraform/`) and **apply the schema** — DEPLOY.md §1–2.
2. **Seed over the Data API** and optionally flip `EMBEDDING_PROVIDER=aurora_ml`
   (with `aws_ml` extension) — DEPLOY.md §3.
3. **Deploy to Vercel** with Marketplace OIDC (no AWS keys) — DEPLOY.md §4.
4. **Capture deliverables**: app link, architecture diagram (README Mermaid),
   DB-proof screenshot (`npm run db:proof`), public repo, **Vercel Team ID**.
5. **Record the < 3-min video** (CLAUDE.md §10) and **publish `WRITEUP.md`** tagged
   **#H0Hackathon**.

See **BLOCKERS.md** for boundaries (all expected; none blocking) and **DECISIONS.md**
for the rationale behind every non-obvious choice.

## Repo map
```
db/schema.sql      schema + every SQL function (the engine)
fixtures/          synthetic green/yellow/red runs + manifest
src/lib/           db seam (pg + Data API), embeddings, ingest, drift, audit, breaker, runs, pipeline
src/app/           Next.js dashboard + API routes
scripts/           apply-schema, seed, verify-fixtures, db-proof, wait-for-db
tests/             drift + hash + policy integration tests (real DB, 20 tests)
terraform/         Aurora Serverless v2 + Data API + Aurora ML role
README · DEPLOY · WRITEUP · DECISIONS · PROGRESS · BLOCKERS
```
