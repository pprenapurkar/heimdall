# SUBMISSION.md - your step-by-step guide to ship & submit Heimdall

This is the **operator runbook** for the **H0: Hack the Zero Stack with Vercel v0 and
AWS Databases** hackathon (Devpost: https://h01.devpost.com/). It takes the
locally-finished Heimdall to a live Vercel + Aurora deployment and walks every
required Devpost deliverable.

- **Track:** Monetizable B2B (AI governance / compliance for regulated workflows).
- **AWS database:** **Amazon Aurora PostgreSQL** (used as the reasoning + audit engine, not just storage).
- **Frontend host:** Vercel.
- **Hard deadline:** **Jun 29, 2026 @ 5:00pm PDT.** Submit at least an hour early.

> Technical depth for each infra step lives in **DEPLOY.md**. This file is the
> ordered checklist + the Devpost-specific bits (video, Team ID, screenshots, write-up).

---

## 0. Pre-flight - what's already done vs. what you must do

**Done (verified locally):** the whole product. C1-C5 + X1 (cost-after-drift) + X3
(circuit breaker) + X4 (Art. 12 export) are built and tested (35 tests). X2 (Aurora ML
in-SQL) is written and flag-gated. See `SUMMARY.md`.

**You must do (≈ 2-4 hours):**
1. Create AWS + Vercel accounts and enable Bedrock (§1).
2. Provision Aurora and apply the schema (§2-3).
3. Deploy the frontend to Vercel (§4).
4. Capture the 5 Devpost deliverables (§5-9).
5. Publish the bonus write-up (§10) and submit (§11).

Accounts/keys you need: an **AWS account** (billing enabled), a **Vercel account**, a
**YouTube account** (for the demo video), and a public blog account (dev.to / Medium /
LinkedIn) for the bonus.

---

## 1. AWS account + Bedrock model access (~15 min)

1. Sign in to AWS. Pick one region and use it everywhere - **`us-east-1`** is simplest
   (best Bedrock coverage). Note it.
2. **Enable Bedrock models** (needed for X2 and the in-SQL story): AWS Console >
   **Amazon Bedrock > Model access > Manage model access** > enable
   - `amazon.titan-embed-text-v2:0` (embeddings)
   - `anthropic.claude-3-haiku` (drift explanations)
   Approval is usually instant.
3. Install tooling locally: **AWS CLI** (`aws configure` with an admin IAM user),
   **Terraform ≥ 1.5**, and **psql** (`brew install postgresql@16`).

> 💡 You don't strictly need Aurora ML to win - the app runs fully on the local
> embedding provider. But enabling Bedrock lets you flip `EMBEDDING_PROVIDER=aurora_ml`
> and say truthfully on camera: *"the database performs the inference."* High ROI for
> the Technological Implementation criterion.

---

## 2. Provision Aurora PostgreSQL (~20 min, mostly waiting)

From the repo root:

```bash
cd terraform
terraform init
terraform apply -var='region=us-east-1' -var='admin_cidrs=["YOUR.PUBLIC.IP/32"]'
```

(Find your IP: `curl ifconfig.me`. The `admin_cidrs` rule is only so you can run psql
once; the app never uses it.)

When it finishes, save the outputs - you'll paste these into Vercel:

```bash
terraform output      # cluster_arn, secret_arn, database_name, cluster_endpoint, bedrock_role_arn
```

This creates an **Aurora Serverless v2** cluster with the **RDS Data API** enabled and a
Bedrock IAM role attached. **Cost note:** Serverless v2 bills while running. Either keep
it up only through judging, or set `min_acu=0` later. Destroy with `terraform destroy`
when done.

---

## 3. Apply schema + seed the 3 demo runs (~10 min)

```bash
# from repo root
export PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id tracejudge/master --query SecretString --output text | jq -r .password)

psql "host=$(cd terraform && terraform output -raw cluster_endpoint) \
  user=tracejudge dbname=tracejudge sslmode=require" -f db/schema.sql
```

(Optional, for X2) enable in-SQL inference:
```sql
CREATE EXTENSION IF NOT EXISTS aws_ml CASCADE;
```

Seed over the Data API (proves the production path works):
```bash
DB_MODE=data-api \
AURORA_CLUSTER_ARN=$(cd terraform && terraform output -raw cluster_arn) \
AURORA_SECRET_ARN=$(cd terraform && terraform output -raw secret_arn) \
AURORA_DATABASE=tracejudge AWS_REGION=us-east-1 EMBEDDING_PROVIDER=local \
npx tsx scripts/seed.ts
# expect: green / yellow / red verdicts printed
```

Switch `EMBEDDING_PROVIDER=aurora_ml` (and `SEMANTIC_DRIFT_THRESHOLD=0.45`,
`CB_DRIFT_SCORE_HALT=0.75`) only after confirming Bedrock access, then re-seed.

---

## 4. Deploy the frontend to Vercel (~20 min)

```bash
npm i -g vercel
vercel link          # create/link the project (this also gives you the Team scope)
```

**Set Production environment variables** (Vercel dashboard > Project > Settings >
Environment Variables) - note there are **no AWS access keys**:

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

**Wire AWS auth via Vercel Marketplace OIDC (no committed keys):**
1. Vercel dashboard > **Integrations** > search **AWS** > connect your AWS account (OIDC).
2. In AWS IAM, create a role trusting Vercel's OIDC provider with a policy allowing
   `rds-data:*` on the cluster and `secretsmanager:GetSecretValue` on the secret.
3. Follow the integration's prompt to bind the role to the project. (`@aws-sdk/client-rds-data`
   picks up the short-lived creds automatically.)

Deploy:
```bash
vercel deploy --prod      # prints your production URL
```

Open the URL > confirm the three runs render **green / yellow / red**, the red run shows
the drift timeline + circuit-breaker halt + cost-after-drift, **Tamper** flips the audit
badge, and **Export Art. 12 bundle** downloads JSON. If anything 500s, check the env
vars and the OIDC role permissions.

---

## 5. Deliverable ① - Text description (specify the AWS database)

On the Devpost submission form, write the project description. **Must state which AWS
database you used.** Suggested opening (edit freely):

> *I built Heimdall (the Heimdall Protocol), a flight recorder for autonomous AI agents,
> on Amazon Aurora PostgreSQL. I use Aurora as the brain of the system rather than as storage: it is the
> trace store (JSONB plus relational columns), the semantic judge (pgvector cosine
> similarity), the policy engine (SQL rules), and a tamper-evident audit ledger (a
> pgcrypto sha256 hash chain that a recursive query verifies). It decides whether an
> agent drifted from its assigned task and produces an EU AI Act Article 12 compliance
> bundle. The frontend runs on Vercel and reaches AWS connection-free through the RDS
> Data API, with auth via Vercel's AWS OIDC integration, so there are no AWS keys in
> the repo.*

Pull talking points from `README.md` and `WRITEUP.md`.

## 6. Deliverable ② - Demo video (< 3:00, YouTube preferred)

Record screen + voiceover. Follow the beats from `CLAUDE.md` §10 (keep it under 3:00):

- **0:00-0:25 Problem.** Agents act unsupervised; you can't prove what they did. EU AI
  Act Art. 12 (enforceable Aug 2, 2026) demands tamper-evident records.
- **0:25-1:20 App.** Show the green, yellow, and red runs in the dashboard.
- **1:20-2:10 Database reveal.** Open the red run: drift timeline, the highlighted drift
  point, cost-after-drift (87.5% wasted), circuit-breaker halt. Say clearly: *"this is
  computed in Aurora - JSONB traces, pgvector similarity, SQL rules, a sha256 hash chain
  - not just logs."* Click **Tamper** > audit badge flips to **Tamper detected**. Click
  **Export Art. 12 bundle**.
- **2:10-2:40 Architecture.** Show the README Mermaid diagram: Vercel > RDS Data API >
  Aurora > Aurora ML/Bedrock.
- **2:40-3:00 Impact.** Trustworthy flight recorder before agents go to production;
  Art. 12; penalties up to €15M / 3% of turnover.

Upload to **YouTube as Public or Unlisted** (the rules say not unlisted for the *bonus*
content; the demo video itself just needs to be viewable - use **Public** to be safe).
Tip: also run `npm run db:proof` on camera for 5 seconds - it's a strong "the DB does
the work" beat.

## 7. Deliverable ③ - Vercel project link + Team ID

- **Project link:** your `vercel deploy --prod` URL.
- **Team ID:** Vercel dashboard > **Settings** (the team/scope you deployed under) >
  **General** > **Team ID** (looks like `team_xxxxxxxxxxxxxxxx`). Copy it verbatim into
  the Devpost form. (CLI alt: `vercel teams ls` then inspect, or check `.vercel/project.json`
  for `orgId`.)

## 8. Deliverable ④ - Architecture diagram

You already have one: the **Mermaid diagram in `README.md`**. Devpost wants an image, so
export it to PNG:
- Easiest: open the README on GitHub (it renders Mermaid), screenshot the diagram; **or**
- Paste the Mermaid block into https://mermaid.live and export PNG/SVG.
Upload the image as the architecture diagram and/or include it in the gallery.

## 9. Deliverable ⑤ - Database-usage proof screenshot

Provide a screenshot that proves Aurora is real and in use. Capture **both** for a strong
submission:
1. **AWS Console** > RDS > your `tracejudge` Aurora cluster page (shows engine =
   aurora-postgresql, Serverless v2, Data API enabled).
2. **`npm run db:proof`** output (run it pointed at Aurora via the `DB_MODE=data-api`
   env from §3) - it prints verdicts, pgvector cosine distances, the sha256 hash chain,
   cost-after-drift, and JSONB payloads. This is the most convincing "the database is
   doing the reasoning" artifact.

---

## 10. Bonus (do this - likely decisive): public #H0Hackathon write-up

The rules award bonus points for a public build post. You have a draft: **`WRITEUP.md`**.

1. Publish it on **dev.to / Medium / LinkedIn / builder.aws.com / YouTube** - **Public,
   not unlisted.**
2. It must **mention the AWS database (Aurora PostgreSQL) and Vercel**, state it was
   **created for the hackathon**, and include the hashtag **`#H0Hackathon`**.
3. Add the published URL to your Devpost submission.

Suggested closing line to add to the post: *"Built for the H0 Hackathon using Amazon
Aurora PostgreSQL and Vercel. #H0Hackathon"*

---

## 11. Submit on Devpost

1. Go to https://h01.devpost.com/ > **Enter a submission**.
2. Fill: project name (**Heimdall**), tagline (**Heimdall Protocol: A Flight Recorder for
   Autonomous AI Agents**), the **text description** (§5, names Aurora), **track = Monetizable B2B**.
3. Attach/paste: **demo video URL** (§6), **Vercel link + Team ID** (§7),
   **architecture diagram** (§8), **DB-usage proof screenshot(s)** (§9), **public repo
   URL**, and the **#H0Hackathon write-up URL** (§10).
4. Add the **public GitHub repo** link (push this repo first - see below).
5. **Save draft, review, then Submit.** Do this **before 5:00pm PDT Jun 29, 2026.**

### Push the repo public first
```bash
# create an empty public repo on GitHub, then:
git remote add origin https://github.com/<you>/tracejudge.git
git push -u origin main
```
(The repo already excludes secrets via `.gitignore`; `.env.local` is never committed.)

---

## 12. Final pre-submit checklist

- [ ] Live Vercel URL loads; green/yellow/red runs render against **Aurora**.
- [ ] Tamper > "Tamper detected"; Reset restores; Export downloads the Art. 12 JSON.
- [ ] Text description names **Amazon Aurora PostgreSQL**.
- [ ] Demo video **< 3:00**, on YouTube, shows the DB doing the work.
- [ ] Vercel **project link + Team ID** captured.
- [ ] **Architecture diagram** image attached.
- [ ] **DB-usage proof** screenshot(s) attached (AWS console + `db:proof`).
- [ ] **Public GitHub repo** linked.
- [ ] **#H0Hackathon** write-up published publicly and linked.
- [ ] Submitted on Devpost **before the deadline**.

## 13. How this maps to the judging criteria (use in your pitch)

- **Technological Implementation:** Aurora as a reasoning engine - pgvector `<=>`,
  JSONB, SQL rules, pgcrypto hash chain + recursive-CTE verify, window/FILTER cost
  attribution, RLS with a non-superuser role, optional Aurora ML in-SQL. Connection-free
  via RDS Data API + OIDC.
- **Design:** clean verdict dashboard; the drift point is highlighted; one click to
  verify, tamper, or export evidence.
- **Impact & real-world applicability:** EU AI Act Art. 12 is enforceable Aug 2, 2026;
  every B2B team deploying agents in regulated workflows needs this; the export is
  regulator-ready.
- **Originality:** not an observability dashboard - a *judgment + tamper-evidence* layer
  where the database itself decides and proves.

## 14. If you run short on time (cut in this order)

1. Skip flipping to `aurora_ml` - stay on `EMBEDDING_PROVIDER=local` (still 100% real
   pipeline on Aurora). Keep Bedrock access claim out of the video.
2. Use only the `npm run db:proof` screenshot if the AWS console shot is fiddly.
3. The write-up is bonus but high-value - do it even if rushed; it's already drafted.

**Never cut:** the live Vercel+Aurora deploy, the demo video, and the 5 required
deliverables.
