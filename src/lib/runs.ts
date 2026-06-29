/**
 * Read models for the dashboard (C5). Presentation over DB-computed verdicts:
 * the list, timeline, drift findings, cost-after-drift (X1), and audit status
 * all come straight from SQL.
 */
import "./env";
import { withTenant } from "./db";
import { verifyChain, type VerifyResult } from "./audit";
import { getDriftChecks, type DriftCheck } from "./drift";

export interface RunSummary {
  run_id: string;
  task_id: string;
  agent_name: string;
  label: string | null;
  state: string;
  verdict: string | null;
  halted_reason: string | null;
  started_at: string;
  event_count: number;
  drift_count: number;
  total_cost: number;
}

export interface TimelineEvent {
  event_id: string;
  seq: number;
  event_type: string;
  tool_name: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  output_text: string | null;
  raw_event: Record<string, unknown>;
  created_at: string;
  is_drift: boolean;
}

export interface CostAfterDrift {
  total_cost: number;
  cost_before_drift: number;
  cost_after_drift: number;
  first_drift_seq: number | null;
  wasted_pct: number;
}

export interface RunDetail {
  summary: RunSummary;
  goal: string;
  allowed_tools: string[];
  required_steps: string[];
  prohibited_actions: string[];
  timeline: TimelineEvent[];
  drift: DriftCheck[];
  cost: CostAfterDrift;
  audit: VerifyResult;
}

export async function listRuns(tenantId: string): Promise<RunSummary[]> {
  return withTenant(tenantId, async (q) => {
    const res = await q<RunSummary>(
      `SELECT r.run_id, r.task_id, a.name AS agent_name,
              r.label AS label, r.state, r.verdict, r.halted_reason,
              r.started_at::text AS started_at,
              (SELECT count(*) FROM trace_events te WHERE te.run_id = r.run_id) AS event_count,
              (SELECT count(*) FROM drift_checks dc WHERE dc.run_id = r.run_id) AS drift_count,
              (SELECT coalesce(sum(cost_usd),0) FROM trace_events te WHERE te.run_id = r.run_id) AS total_cost
         FROM agent_runs r
         JOIN tasks t ON t.task_id = r.task_id
         JOIN agents a ON a.agent_id = t.agent_id
        ORDER BY r.started_at`
    );
    return res.rows.map(coerceSummary);
  });
}

export async function getRun(
  runId: string,
  tenantId: string
): Promise<RunDetail | null> {
  const [base, drift, audit] = await Promise.all([
    withTenant(tenantId, async (q) => {
      const summaryRes = await q<RunSummary>(
        `SELECT r.run_id, r.task_id, a.name AS agent_name,
                r.label AS label, r.state, r.verdict, r.halted_reason,
                r.started_at::text AS started_at,
                (SELECT count(*) FROM trace_events te WHERE te.run_id = r.run_id) AS event_count,
                (SELECT count(*) FROM drift_checks dc WHERE dc.run_id = r.run_id) AS drift_count,
                (SELECT coalesce(sum(cost_usd),0) FROM trace_events te WHERE te.run_id = r.run_id) AS total_cost
           FROM agent_runs r
           JOIN tasks t ON t.task_id = r.task_id
           JOIN agents a ON a.agent_id = t.agent_id
          WHERE r.run_id = CAST($1 AS uuid)`,
        [runId]
      );
      if (summaryRes.rows.length === 0) return null;

      const taskRes = await q<{
        assigned_goal: string;
        allowed_tools: string[];
        required_steps: string[];
        prohibited_actions: string[];
      }>(
        `SELECT t.assigned_goal, t.allowed_tools, t.required_steps, t.prohibited_actions
           FROM tasks t JOIN agent_runs r ON r.task_id = t.task_id
          WHERE r.run_id = CAST($1 AS uuid)`,
        [runId]
      );

      const timelineRes = await q<TimelineEvent>(
        `SELECT te.event_id, te.seq, te.event_type, te.tool_name, te.model,
                te.input_tokens, te.output_tokens, te.cost_usd, te.output_text,
                te.raw_event, te.created_at::text AS created_at,
                EXISTS (SELECT 1 FROM drift_checks dc WHERE dc.evidence_event = te.event_id) AS is_drift
           FROM trace_events te
          WHERE te.run_id = CAST($1 AS uuid)
          ORDER BY te.seq`,
        [runId]
      );

      const costRes = await q<CostAfterDrift>(
        `SELECT total_cost, cost_before_drift, cost_after_drift,
                first_drift_seq, wasted_pct
           FROM tj_cost_after_drift(CAST($1 AS uuid))`,
        [runId]
      );

      return {
        summary: coerceSummary(summaryRes.rows[0]),
        task: taskRes.rows[0],
        timeline: timelineRes.rows.map((e) => ({
          ...e,
          cost_usd: Number(e.cost_usd),
          is_drift: e.is_drift === true || (e.is_drift as unknown) === "t",
        })),
        cost: coerceCost(costRes.rows[0]),
      };
    }),
    getDriftChecks(runId, tenantId),
    verifyChain(runId, tenantId),
  ]);

  if (!base) return null;
  return {
    summary: base.summary,
    goal: base.task.assigned_goal,
    allowed_tools: base.task.allowed_tools,
    required_steps: base.task.required_steps,
    prohibited_actions: base.task.prohibited_actions,
    timeline: base.timeline,
    drift,
    cost: base.cost,
    audit,
  };
}

function coerceSummary(r: RunSummary): RunSummary {
  return {
    ...r,
    event_count: Number(r.event_count),
    drift_count: Number(r.drift_count),
    total_cost: Number(r.total_cost),
  };
}

function coerceCost(r: CostAfterDrift | undefined): CostAfterDrift {
  if (!r)
    return {
      total_cost: 0,
      cost_before_drift: 0,
      cost_after_drift: 0,
      first_drift_seq: null,
      wasted_pct: 0,
    };
  return {
    total_cost: Number(r.total_cost),
    cost_before_drift: Number(r.cost_before_drift),
    cost_after_drift: Number(r.cost_after_drift),
    first_drift_seq: r.first_drift_seq === null ? null : Number(r.first_drift_seq),
    wasted_pct: Number(r.wasted_pct),
  };
}
