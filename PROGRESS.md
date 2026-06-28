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

**Next**
- C5 dashboard (Next.js) + API routes (ingest, runs, verify, tamper-demo, reset).
- Then: README + Mermaid diagram, Terraform, DEPLOY.md, #H0Hackathon write-up.
