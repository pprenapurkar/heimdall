# PROGRESS

Living status log. Newest entries at the bottom.

## ✅ Backend pipeline complete & verified (C1–C4, X1, X3)

**Done**
- Scaffold: Next.js config, TS, Docker `pgvector/pgvector:pg16`, env loader, two DB
  backends (`pg` local + RDS Data API stub) behind `src/lib/db.ts`.
- `db/schema.sql`: full §4 schema + RLS (FORCE) + SQL functions for the hash chain,
  drift engine, circuit breaker, and cost-after-drift.
- Embeddings: deterministic local feature-hashing provider (+ openai / aurora_ml
  gated). `src/lib/*`: ingest (C1+C2+C4), drift (C3), audit (C4), breaker (X3),
  runs read-model, pipeline orchestrator.
- Fixtures: `fixtures/{agent,green,yellow,red}.json` (synthetic refund-agent).
- Tests (TDD, real DB, isolated tenants): `tests/drift.test.ts`, `tests/hash.test.ts`.
- Scripts: `wait-for-db`, `apply-schema`, `seed`, `verify-fixtures`.

**Verified** (`npm run db:reset` then both harnesses):
- `verify-fixtures.ts`: **17/17 checks pass**.
  - green → verdict green, 0 drift.
  - yellow → verdict yellow, `missing_evidence`.
  - red → verdict red, `unauthorized_tool` + `semantic_drift` (+ prohibited_*),
    circuit breaker halts on unauthorized tool.
  - X1 cost-after-drift: first drift at seq 3, **87.5% of spend after drift**.
  - C4 tamper: editing event seq 2 → verification fails, localized to seq 2;
    restored after re-ingest.
- `vitest run`: **9/9 tests pass**.

## ✅ Frontend + docs + RLS hardening complete

**Done since**
- C5 dashboard (Next.js App Router): runs list (R/Y/G), run detail with
  drift-highlighted OTel timeline, declared-intent panel, cost-after-drift panel,
  live audit verify/tamper/reset.
- API routes: `POST /api/ingest`, `GET /api/runs[/:id]`, `POST .../verify`,
  `POST .../tamper`, `POST /api/seed`. Smoke-tested over HTTP.
- Docs: README (Mermaid architecture + feature map + quickstart), `terraform/`
  (Aurora Serverless v2 + Data API + Aurora ML role), DEPLOY.md, WRITEUP.md
  (#H0Hackathon draft), `scripts/db-proof.ts` (`npm run db:proof`).
- **RLS hardening**: discovered superusers bypass RLS; `withTenant()` now drops to
  a non-superuser `tracejudge_app` role per transaction, so isolation is real.
  Expanded tests to cover RLS isolation, X1, X3, and prohibited rules.

**Verified**
- `npm run db:reset` → `verify:fixtures` 17/17, `npm test` **20/20** (3 suites).
- App API smoke test (runs/verify/tamper/reset) green with RLS active.
- `npm run db:proof` prints the SQL evidence (verdicts, pgvector distances, hash
  chain, cost-after-drift, JSONB payloads).

**Next / left for operator**
- Provision Aurora + deploy to Vercel (DEPLOY.md), capture Vercel Team ID.
- Record < 3-min demo video (CLAUDE.md §10); publish #H0Hackathon write-up.
- Optional: screenshot dashboard + `db:proof` for deliverables.
