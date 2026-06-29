# BLOCKERS

No hard blockers. The full pipeline builds, runs, and is verified locally. The items
below are **expected boundaries** of a local-first build, not failures - each has a
ready path forward documented in DEPLOY.md.

## Boundaries (by design, not blocking)

1. **Aurora ML in-SQL (X2) can't run locally.** `aws_bedrock.invoke_model*` only
   exists on Aurora with the `aws_ml` extension + IAM role + Bedrock access. The code
   path is written and flag-gated (`EMBEDDING_PROVIDER=aurora_ml`); locally we use the
   deterministic feature-hashing provider, which exercises the identical pgvector
   `<=>` drift path. Switch on Aurora per DEPLOY.md §3.

2. **Live Aurora cluster + Vercel deploy are operator steps.** Requires AWS/Vercel
   accounts and credentials I don't have. Terraform + step-by-step are in
   `terraform/` and DEPLOY.md. The `DB_MODE=data-api` path is written but unexercised
   locally (no Aurora to hit).

3. **Deliverables needing a human:** < 3-min demo video, Vercel Team ID, and
   publishing the #H0Hackathon write-up (`WRITEUP.md` is drafted).

## Notes / things to watch on deploy

- Aurora master is an `rds_superuser`; confirm RLS still enforces after deploy by
  running `tests/policy.test.ts` semantics (the `SET LOCAL ROLE tracejudge_app` in
  `withTenant()` handles this - see DECISIONS.md D7). If isolation looks off, verify
  `GRANT tracejudge_app TO current_user` succeeded during schema apply.
- When switching to real embeddings, set `SEMANTIC_DRIFT_THRESHOLD=0.45` and
  `CB_DRIFT_SCORE_HALT=0.75` (the 0.80/0.90 values are calibrated for local
  feature-hashing - see DECISIONS.md D4).
