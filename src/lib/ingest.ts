/**
 * Ingestion pipeline: C1 (registry) + C2 (trace store) + C4 (hash chain wiring).
 *
 * Flow per CLAUDE.md §8: ingest events -> append to hash chain -> (later)
 * detect drift. Embeddings are produced by the configured provider; for the
 * aurora_ml provider they are generated in-SQL via aws_bedrock instead (X2).
 *
 * All writes go through withTenant() so RLS is enforced by the database.
 */
import "./env";
import { randomUUID } from "node:crypto";
import { withTenant, type TenantQuery } from "./db";
import {
  embed,
  embeddingsComputedInDb,
  toVectorLiteral,
  getProvider,
} from "./embeddings";

export interface AgentManifest {
  agent_id: string;
  name: string;
  owner: string;
  risk_level: "low" | "medium" | "high";
  policy_version?: number;
}
export interface TaskManifest {
  task_id: string;
  assigned_goal: string;
  allowed_tools: string[];
  required_steps: string[];
  prohibited_actions: string[];
  prohibited_data?: string[];
  max_budget_usd: number;
}
export interface RawTraceEvent {
  seq: number;
  event_type: string;
  tool_name?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  output_text?: string;
  raw_event: Record<string, unknown>;
}
export interface RunFixture {
  run_id: string;
  task_id: string;
  label?: string;
  events: RawTraceEvent[];
}

const DEFAULT_TENANT =
  process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

/** C1 — register (or update) an agent + task manifest. Computes goal embedding. */
export async function registerManifest(
  agent: AgentManifest,
  task: TaskManifest,
  tenantId: string = DEFAULT_TENANT
): Promise<void> {
  const useDbEmbeddings = embeddingsComputedInDb();
  let goalVec: string | null = null;
  if (!useDbEmbeddings) {
    goalVec = toVectorLiteral((await embed([task.assigned_goal]))[0]);
  }

  await withTenant(tenantId, async (q) => {
    await q(
      `INSERT INTO agents (agent_id, tenant_id, name, owner, risk_level, policy_version)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (agent_id) DO UPDATE SET
         name=EXCLUDED.name, owner=EXCLUDED.owner,
         risk_level=EXCLUDED.risk_level, policy_version=EXCLUDED.policy_version`,
      [
        agent.agent_id,
        tenantId,
        agent.name,
        agent.owner,
        agent.risk_level,
        agent.policy_version ?? 1,
      ]
    );

    await q(
      `INSERT INTO tasks (task_id, tenant_id, agent_id, assigned_goal, allowed_tools,
                          required_steps, prohibited_actions, prohibited_data,
                          max_budget_usd, goal_embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${goalVec === null ? "NULL" : "$10::vector"})
       ON CONFLICT (task_id) DO UPDATE SET
         assigned_goal=EXCLUDED.assigned_goal, allowed_tools=EXCLUDED.allowed_tools,
         required_steps=EXCLUDED.required_steps, prohibited_actions=EXCLUDED.prohibited_actions,
         prohibited_data=EXCLUDED.prohibited_data, max_budget_usd=EXCLUDED.max_budget_usd,
         goal_embedding=EXCLUDED.goal_embedding`,
      goalVec === null
        ? [
            task.task_id,
            tenantId,
            agent.agent_id,
            task.assigned_goal,
            task.allowed_tools,
            task.required_steps,
            task.prohibited_actions,
            task.prohibited_data ?? [],
            task.max_budget_usd,
          ]
        : [
            task.task_id,
            tenantId,
            agent.agent_id,
            task.assigned_goal,
            task.allowed_tools,
            task.required_steps,
            task.prohibited_actions,
            task.prohibited_data ?? [],
            task.max_budget_usd,
            goalVec,
          ]
    );

    if (useDbEmbeddings) await populateGoalEmbeddingInDb(q, task.task_id);
  });
}

/**
 * C2 + C4 — ingest a run as ordered events and extend the tamper-evident chain.
 * Idempotent: clears any prior data for the run first.
 */
export async function ingestRun(
  fixture: RunFixture,
  tenantId: string = DEFAULT_TENANT
): Promise<{ run_id: string; events: number }> {
  const useDbEmbeddings = embeddingsComputedInDb();

  // Compute embeddings up-front (app-side providers only).
  let vectors: (string | null)[] = fixture.events.map(() => null);
  if (!useDbEmbeddings) {
    const texts = fixture.events.map(
      (e) => `${e.tool_name ?? ""} ${e.output_text ?? ""}`.trim()
    );
    const embs = await embed(texts);
    vectors = embs.map(toVectorLiteral);
  }

  return withTenant(tenantId, async (q) => {
    // Idempotent reset for this run.
    await q(`DELETE FROM audit_chain WHERE run_id = $1`, [fixture.run_id]);
    await q(`DELETE FROM drift_checks WHERE run_id = $1`, [fixture.run_id]);
    await q(`DELETE FROM trace_events WHERE run_id = $1`, [fixture.run_id]);
    await q(`DELETE FROM agent_runs WHERE run_id = $1`, [fixture.run_id]);

    await q(
      `INSERT INTO agent_runs (run_id, tenant_id, task_id, state, label)
       VALUES ($1,$2,$3,'running',$4)`,
      [fixture.run_id, tenantId, fixture.task_id, fixture.label ?? null]
    );

    const ordered = [...fixture.events].sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i];
      const eventId = randomUUID();
      const vec = vectors[fixture.events.indexOf(e)];
      await q(
        `INSERT INTO trace_events
           (event_id, run_id, tenant_id, seq, event_type, tool_name, model,
            input_tokens, output_tokens, cost_usd, output_text, raw_event, event_embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                 ${vec === null ? "NULL" : "$13::vector"})`,
        vec === null
          ? [
              eventId,
              fixture.run_id,
              tenantId,
              e.seq,
              e.event_type,
              e.tool_name ?? null,
              e.model ?? null,
              e.input_tokens ?? null,
              e.output_tokens ?? null,
              e.cost_usd ?? 0,
              e.output_text ?? null,
              JSON.stringify(e.raw_event),
            ]
          : [
              eventId,
              fixture.run_id,
              tenantId,
              e.seq,
              e.event_type,
              e.tool_name ?? null,
              e.model ?? null,
              e.input_tokens ?? null,
              e.output_tokens ?? null,
              e.cost_usd ?? 0,
              e.output_text ?? null,
              JSON.stringify(e.raw_event),
              vec,
            ]
      );

      // C4 — extend the hash chain in SQL (sha256(prev || canonical)).
      await q(`SELECT tj_append_to_chain($1)`, [eventId]);
    }

    if (useDbEmbeddings) await populateEventEmbeddingsInDb(q, fixture.run_id);

    return { run_id: fixture.run_id, events: ordered.length };
  });
}

// ---------------------------------------------------------------------------
// X2 — Aurora ML in-SQL embeddings (production only, EMBEDDING_PROVIDER=aurora_ml).
// "The database itself performs the inference." Requires the aws_ml extension,
// an IAM role with Bedrock access, and VPC networking (see DEPLOY.md). Never
// exercised locally; the local/openai paths above are the fallback.
// ---------------------------------------------------------------------------
const BEDROCK_EMBED_MODEL =
  process.env.BEDROCK_EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0";

async function populateGoalEmbeddingInDb(q: TenantQuery, taskId: string): Promise<void> {
  await q(
    `UPDATE tasks
        SET goal_embedding =
          aws_bedrock.invoke_model_get_embeddings(
            model_id    => $2,
            content_type=> 'application/json',
            json_key    => 'embedding',
            model_input => json_build_object('inputText', assigned_goal)::text
          )::vector
      WHERE task_id = $1`,
    [taskId, BEDROCK_EMBED_MODEL]
  );
}

async function populateEventEmbeddingsInDb(q: TenantQuery, runId: string): Promise<void> {
  await q(
    `UPDATE trace_events
        SET event_embedding =
          aws_bedrock.invoke_model_get_embeddings(
            model_id    => $2,
            content_type=> 'application/json',
            json_key    => 'embedding',
            model_input => json_build_object('inputText',
                             coalesce(tool_name,'') || ' ' || coalesce(output_text,''))::text
          )::vector
      WHERE run_id = $1 AND output_text IS NOT NULL`,
    [runId, BEDROCK_EMBED_MODEL]
  );
}

export function activeEmbeddingProvider(): string {
  return getProvider();
}
