# DEPLOY.md - provision Aurora + ship to Vercel

Step-by-step for taking the locally-verified TraceJudge to production: Aurora
PostgreSQL Serverless v2 (reached over the RDS Data API) + the Next.js frontend on
Vercel. Synthetic data only.

Everything in `src/lib/db.ts` already supports the production path (`DB_MODE=data-api`);
this guide just wires the infrastructure to it.

---

## 0. Prerequisites

- AWS account with permissions for RDS, Secrets Manager, IAM, Bedrock.
- **Bedrock model access** enabled (for X2): request access to
  `amazon.titan-embed-text-v2:0` and `anthropic.claude-3-haiku` in the Bedrock console.
- Terraform ≥ 1.5, AWS CLI configured, and `psql` (for the one-time schema apply).
- A Vercel account + the Vercel CLI (`npm i -g vercel`).

## 1. Provision Aurora (Terraform)

```bash
cd terraform
terraform init
# Allow your IP for the one-time psql schema apply:
terraform apply -var='admin_cidrs=["YOUR.PUBLIC.IP/32"]'
```

Capture the outputs:

```bash
terraform output      # cluster_arn, secret_arn, database_name, cluster_endpoint, bedrock_role_arn
```

The cluster has `enable_http_endpoint = true` (RDS Data API) and an IAM role attached
for Aurora ML → Bedrock.

## 2. Apply the schema

Pull the master password from Secrets Manager and apply `db/schema.sql` once over psql:

```bash
export PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id tracejudge/master --query SecretString --output text | jq -r .password)

psql "host=$(terraform output -raw cluster_endpoint) user=tracejudge dbname=tracejudge sslmode=require" \
  -f ../db/schema.sql
```

`db/schema.sql` is idempotent and creates `vector` + `pgcrypto`, all tables, RLS
policies, and the SQL functions - identical to local.

**For the Aurora ML path (X2 only):** also enable the in-SQL inference extension:

```sql
CREATE EXTENSION IF NOT EXISTS aws_ml CASCADE;
```

(The local schema deliberately omits `aws_ml` because it doesn't exist off-Aurora.)

## 3. Seed the demo over the Data API

From the repo root, point the seed at Aurora and run the same pipeline you ran locally:

```bash
DB_MODE=data-api \
AURORA_CLUSTER_ARN=$(cd terraform && terraform output -raw cluster_arn) \
AURORA_SECRET_ARN=$(cd terraform && terraform output -raw secret_arn) \
AURORA_DATABASE=tracejudge \
AWS_REGION=us-east-1 \
EMBEDDING_PROVIDER=local \
npx tsx scripts/seed.ts
```

> Use `EMBEDDING_PROVIDER=local` first to confirm the wiring, then switch to
> `aurora_ml` (and set `SEMANTIC_DRIFT_THRESHOLD=0.45`, `CB_DRIFT_SCORE_HALT=0.75`)
> once Bedrock access is confirmed. The `aurora_ml` path computes embeddings in SQL
> via `aws_bedrock.invoke_model_get_embeddings` - no app-side embedding calls.

## 4. Deploy the frontend to Vercel

```bash
vercel link           # create/link the project
```

Set the project **Environment Variables** (Production) - no AWS keys:

| Var | Value |
|---|---|
| `DB_MODE` | `data-api` |
| `AURORA_CLUSTER_ARN` | from `terraform output` |
| `AURORA_SECRET_ARN` | from `terraform output` |
| `AURORA_DATABASE` | `tracejudge` |
| `AWS_REGION` | `us-east-1` |
| `EMBEDDING_PROVIDER` | `local` (or `aurora_ml`) |
| `SEMANTIC_DRIFT_THRESHOLD` | `0.80` local / `0.45` aurora_ml |
| `CB_DRIFT_SCORE_HALT` | `0.90` local / `0.75` aurora_ml |
| `DEFAULT_TENANT_ID` | `00000000-0000-0000-0000-000000000001` |

### AWS auth via Vercel Marketplace OIDC (no committed keys)

1. In the Vercel dashboard: **Integrations → AWS** (Marketplace OIDC), connect your
   AWS account. This issues short-lived credentials to the deployment at runtime.
2. Create an AWS IAM role trusting Vercel's OIDC provider with a policy allowing
   `rds-data:*` on the cluster and `secretsmanager:GetSecretValue` on the secret
   (and `bedrock:InvokeModel` if using `aurora_ml` from the app - not needed when
   embeddings run inside Aurora).
3. Set the role ARN per the integration's instructions. The `@aws-sdk/client-rds-data`
   client in `src/lib/db.ts` picks up these credentials automatically.

```bash
vercel deploy --prod
```

## 5. Verify in production

- Open the deployment URL → the three runs render green / yellow / red.
- Click the red run → drift timeline + circuit-breaker halt + cost-after-drift.
- Click **Tamper (seq 2)** → audit badge flips to **Tamper detected**; **Reset demo** restores.
- `POST /api/ingest` with a fixture body re-runs the pipeline against Aurora.

## 6. Lock down (after setup)

```bash
cd terraform
terraform apply -var='publicly_accessible=false' -var='admin_cidrs=[]'
```

The Vercel app keeps working - it never used the public endpoint, only the Data API.

## Submission deliverables

- **Working app link**: the Vercel production URL.
- **Architecture diagram**: README Mermaid diagram (export to PNG if a static image is required).
- **DB-usage proof screenshot**: run `npm run db:proof` (or the equivalent in the RDS
  query editor) and screenshot the output.
- **Public repo**: this repository.
- **Vercel Team ID**: Vercel dashboard → Settings → Team ID.
- **Demo video (< 3 min)**: follow CLAUDE.md §10.
- **#H0Hackathon write-up**: see `WRITEUP.md`.
