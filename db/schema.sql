-- ============================================================================
-- TraceJudge - Aurora PostgreSQL schema (the product IS the database)
-- ----------------------------------------------------------------------------
-- This file is idempotent: safe to re-apply. It defines the relational intent
-- store, the OTel-GenAI-aligned trace store, the tamper-evident hash chain, the
-- drift rules engine, and the verdict roll-up - with the hard logic living in
-- SQL, not the app layer.
--
-- Runs on the local Docker pgvector/pgvector:pg16 image AND on Aurora
-- PostgreSQL 16 unchanged (pgvector + pgcrypto are available on both).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: semantic drift via <=>
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest()/sha256 for the audit chain

-- ----------------------------------------------------------------------------
-- 1. WHO/WHAT the agent is allowed to do (declared intent)  [C1]
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  agent_id       uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  name           text NOT NULL,
  owner          text NOT NULL,
  risk_level     text NOT NULL CHECK (risk_level IN ('low','medium','high')),
  policy_version int  NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id              uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  agent_id             uuid NOT NULL REFERENCES agents(agent_id),
  assigned_goal        text NOT NULL,
  allowed_tools        text[] NOT NULL,
  required_steps       text[] NOT NULL,
  prohibited_actions   text[] NOT NULL,
  prohibited_data      text[] NOT NULL DEFAULT '{}',
  max_budget_usd       numeric(10,4) NOT NULL DEFAULT 1.00,
  goal_embedding       vector(1536)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id        uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  task_id       uuid NOT NULL REFERENCES tasks(task_id),
  state         text NOT NULL DEFAULT 'running'
                CHECK (state IN ('running','completed','halted')),
  label         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  halted_reason text,
  verdict       text CHECK (verdict IN ('green','yellow','red'))
);

-- ----------------------------------------------------------------------------
-- 2. WHAT the agent actually did (OTel GenAI-aligned trace store)  [C2]
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trace_events (
  event_id        uuid PRIMARY KEY,
  run_id          uuid NOT NULL REFERENCES agent_runs(run_id),
  tenant_id       uuid NOT NULL,
  seq             int  NOT NULL,
  event_type      text NOT NULL,   -- invoke_agent|execute_tool|chat|memory_read|
                                    -- memory_write|evidence_retrieved
  tool_name       text,            -- gen_ai.tool.name
  model           text,            -- gen_ai.request.model
  input_tokens    int,             -- gen_ai.usage.input_tokens
  output_tokens   int,             -- gen_ai.usage.output_tokens
  cost_usd        numeric(10,4) DEFAULT 0,
  output_text     text,
  raw_event       jsonb NOT NULL,  -- full span payload (JSONB)
  event_embedding vector(1536),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events (run_id, seq);
CREATE INDEX IF NOT EXISTS idx_trace_events_embedding
  ON trace_events USING hnsw (event_embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- 3. WHY we trust it - tamper-evident hash chain  [C4]
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_chain (
  event_id      uuid PRIMARY KEY REFERENCES trace_events(event_id),
  run_id        uuid NOT NULL,
  seq           int  NOT NULL,
  prev_hash     text,
  current_hash  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_chain_run_seq ON audit_chain (run_id, seq);

-- ----------------------------------------------------------------------------
-- 4. DRIFT findings  [C3]
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drift_checks (
  check_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  check_type      text NOT NULL,   -- unauthorized_tool|missing_step|missing_evidence|
                                    -- prohibited_action|prohibited_data|semantic_drift
  severity        text NOT NULL CHECK (severity IN ('info','warn','critical')),
  evidence_event  uuid,
  score           numeric,
  explanation     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drift_checks_run ON drift_checks (run_id);

-- ============================================================================
-- ROW-LEVEL SECURITY - every tenant sees only its own rows.
-- Policies key off the per-transaction GUC app.tenant_id (set by src/lib/db.ts
-- withTenant()). FORCE makes RLS apply even to the table owner, so the
-- isolation is real, not cosmetic.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents','tasks','agent_runs','trace_events','drift_checks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $f$, t);
  END LOOP;
END $$;

-- audit_chain has no tenant_id column (it mirrors trace_events 1:1); guard it
-- by run ownership through the trace_events policy at query time.
ALTER TABLE audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_chain;
CREATE POLICY tenant_isolation ON audit_chain
  USING (EXISTS (SELECT 1 FROM trace_events te WHERE te.event_id = audit_chain.event_id))
  WITH CHECK (EXISTS (SELECT 1 FROM trace_events te WHERE te.event_id = audit_chain.event_id));

-- ============================================================================
-- APPLICATION ROLE - RLS is only meaningful when queries run as a NON-superuser
-- (superusers and BYPASSRLS roles ignore RLS even with FORCE). withTenant() does
-- `SET LOCAL ROLE tracejudge_app` per transaction so tenant isolation is real on
-- both the local superuser connection and the Aurora master connection.
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tracejudge_app') THEN
    CREATE ROLE tracejudge_app NOLOGIN;
  END IF;
END $$;
-- Let whoever applies this schema (local superuser / Aurora master) assume the role.
GRANT tracejudge_app TO current_user;
GRANT USAGE ON SCHEMA public TO tracejudge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tracejudge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tracejudge_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tracejudge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tracejudge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO tracejudge_app;

-- ============================================================================
-- HASH CHAIN  [C4] - the DB is the integrity source of truth.
-- ----------------------------------------------------------------------------
-- Canonical, order-stable serialization of one event. jsonb::text emits keys in
-- a deterministic order, so the same logical event always hashes identically.
CREATE OR REPLACE FUNCTION tj_canonical_event(p_event_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    te.run_id::text,
    te.seq::text,
    te.event_type,
    coalesce(te.tool_name, ''),
    coalesce(te.model, ''),
    coalesce(te.input_tokens::text, ''),
    coalesce(te.output_tokens::text, ''),
    coalesce(te.cost_usd::text, '0'),
    coalesce(te.output_text, ''),
    te.raw_event::text
  )
  FROM trace_events te WHERE te.event_id = p_event_id;
$$;

-- Append one event to its run's chain: current = sha256(prev_hash || canonical).
-- prev_hash is the previous (by seq) event's current_hash in the same run.
CREATE OR REPLACE FUNCTION tj_append_to_chain(p_event_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_run_id    uuid;
  v_seq       int;
  v_prev_hash text;
  v_canonical text;
  v_hash      text;
BEGIN
  SELECT run_id, seq INTO v_run_id, v_seq FROM trace_events WHERE event_id = p_event_id;

  SELECT current_hash INTO v_prev_hash
  FROM audit_chain
  WHERE run_id = v_run_id AND seq < v_seq
  ORDER BY seq DESC
  LIMIT 1;

  v_canonical := tj_canonical_event(p_event_id);
  v_hash := encode(digest(coalesce(v_prev_hash, '') || v_canonical, 'sha256'), 'hex');

  INSERT INTO audit_chain (event_id, run_id, seq, prev_hash, current_hash)
  VALUES (p_event_id, v_run_id, v_seq, v_prev_hash, v_hash)
  ON CONFLICT (event_id) DO UPDATE
    SET prev_hash = EXCLUDED.prev_hash, current_hash = EXCLUDED.current_hash;

  RETURN v_hash;
END $$;

-- Recompute the entire chain for a run from the live event rows and compare to
-- the stored hashes. This is the "verify" primitive: any mutation to any event
-- (or to a stored hash) makes recomputed <> stored and is reported as tampered.
-- Returns one row per event with an ok flag, in seq order.
CREATE OR REPLACE FUNCTION tj_verify_chain(p_run_id uuid)
RETURNS TABLE (
  seq            int,
  event_id       uuid,
  stored_hash    text,
  recomputed_hash text,
  ok             boolean
) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE ordered AS (
    SELECT ac.seq, ac.event_id, ac.prev_hash, ac.current_hash AS stored_hash,
           tj_canonical_event(ac.event_id) AS canonical,
           row_number() OVER (ORDER BY ac.seq) AS rn
    FROM audit_chain ac
    WHERE ac.run_id = p_run_id
  ),
  walk AS (
    SELECT o.seq, o.event_id, o.stored_hash, o.canonical, o.rn,
           encode(digest('' || o.canonical, 'sha256'), 'hex') AS recomputed_hash
    FROM ordered o WHERE o.rn = 1
    UNION ALL
    SELECT o.seq, o.event_id, o.stored_hash, o.canonical, o.rn,
           encode(digest(w.recomputed_hash || o.canonical, 'sha256'), 'hex')
    FROM ordered o JOIN walk w ON o.rn = w.rn + 1
  )
  SELECT w.seq, w.event_id, w.stored_hash, w.recomputed_hash,
         (w.stored_hash = w.recomputed_hash) AS ok
  FROM walk w
  ORDER BY w.seq;
$$;

-- ============================================================================
-- DRIFT ENGINE  [C3] - deterministic rules + pgvector semantic similarity,
-- all evaluated in SQL. Idempotent: clears and recomputes for the run.
-- Rolls per-event findings into agent_runs.verdict (green/yellow/red).
-- ============================================================================
CREATE OR REPLACE FUNCTION tj_detect_drift(p_run_id uuid, p_threshold numeric DEFAULT 0.45)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_tenant  uuid;
  v_task    tasks%ROWTYPE;
  v_verdict text;
  v_crit    int;
  v_warn    int;
BEGIN
  SELECT t.* INTO v_task
  FROM agent_runs r JOIN tasks t ON t.task_id = r.task_id
  WHERE r.run_id = p_run_id;
  v_tenant := v_task.tenant_id;

  DELETE FROM drift_checks WHERE run_id = p_run_id;

  -- RULE 1: unauthorized_tool - a tool used that is not in the allowed list.
  -- Array membership via = ANY(...), never NOT IN on an array.
  INSERT INTO drift_checks (run_id, tenant_id, check_type, severity, evidence_event, explanation)
  SELECT p_run_id, v_tenant, 'unauthorized_tool', 'critical', te.event_id,
         format('Tool "%s" is not in the allowed tool list %s.',
                te.tool_name, v_task.allowed_tools::text)
  FROM trace_events te
  WHERE te.run_id = p_run_id
    AND te.tool_name IS NOT NULL
    AND NOT (te.tool_name = ANY (v_task.allowed_tools));

  -- RULE 2: prohibited_action - an event whose tool/type is explicitly banned.
  INSERT INTO drift_checks (run_id, tenant_id, check_type, severity, evidence_event, explanation)
  SELECT p_run_id, v_tenant, 'prohibited_action', 'critical', te.event_id,
         format('Action "%s" is explicitly prohibited for this task.',
                coalesce(te.tool_name, te.event_type))
  FROM trace_events te
  WHERE te.run_id = p_run_id
    AND (te.tool_name = ANY (v_task.prohibited_actions)
         OR te.event_type = ANY (v_task.prohibited_actions));

  -- RULE 3: prohibited_data - banned data keyword appears in the output.
  INSERT INTO drift_checks (run_id, tenant_id, check_type, severity, evidence_event, explanation)
  SELECT p_run_id, v_tenant, 'prohibited_data', 'critical', te.event_id,
         format('Output references prohibited data category "%s".', pd)
  FROM trace_events te
  CROSS JOIN LATERAL unnest(v_task.prohibited_data) AS pd
  WHERE te.run_id = p_run_id
    AND v_task.prohibited_data <> '{}'
    AND te.output_text IS NOT NULL
    AND te.output_text ILIKE '%' || replace(pd, '_', ' ') || '%';

  -- RULE 4: missing_step / missing_evidence - a required step never happened.
  -- 'evidence_retrieved' surfaces as the dedicated missing_evidence check_type.
  INSERT INTO drift_checks (run_id, tenant_id, check_type, severity, explanation)
  SELECT p_run_id, v_tenant,
         CASE WHEN rs = 'evidence_retrieved' THEN 'missing_evidence' ELSE 'missing_step' END,
         'warn',
         format('Required step "%s" never occurred in this run.', rs)
  FROM unnest(v_task.required_steps) AS rs
  WHERE NOT EXISTS (
    SELECT 1 FROM trace_events te
    WHERE te.run_id = p_run_id AND te.event_type = rs
  );

  -- RULE 5: semantic_drift - pgvector cosine DISTANCE between the task goal
  -- embedding and each substantive event embedding exceeds the threshold.
  INSERT INTO drift_checks (run_id, tenant_id, check_type, severity, evidence_event, score, explanation)
  SELECT p_run_id, v_tenant, 'semantic_drift',
         CASE WHEN (te.event_embedding <=> v_task.goal_embedding) > 0.6 THEN 'critical' ELSE 'warn' END,
         te.event_id,
         round((te.event_embedding <=> v_task.goal_embedding)::numeric, 4),
         format('Event output diverges from the assigned goal (cosine distance %s > threshold %s).',
                round((te.event_embedding <=> v_task.goal_embedding)::numeric, 3), p_threshold)
  FROM trace_events te
  WHERE te.run_id = p_run_id
    AND te.event_embedding IS NOT NULL
    AND v_task.goal_embedding IS NOT NULL
    AND te.event_type IN ('execute_tool','chat','memory_write')
    AND (te.event_embedding <=> v_task.goal_embedding) > p_threshold;

  -- Roll up: any critical -> red; any warn -> yellow; else green.
  SELECT count(*) FILTER (WHERE severity = 'critical'),
         count(*) FILTER (WHERE severity = 'warn')
    INTO v_crit, v_warn
  FROM drift_checks WHERE run_id = p_run_id;

  v_verdict := CASE WHEN v_crit > 0 THEN 'red'
                    WHEN v_warn > 0 THEN 'yellow'
                    ELSE 'green' END;

  UPDATE agent_runs SET verdict = v_verdict WHERE run_id = p_run_id;
  RETURN v_verdict;
END $$;

-- ============================================================================
-- CIRCUIT BREAKER  [X3] - evaluate halt policy in the DB. If tripped, flip the
-- run to 'halted', record the reason, and write a synthetic blocked-action
-- event into the trace + audit chain so the block itself is tamper-evident.
-- ============================================================================
CREATE OR REPLACE FUNCTION tj_circuit_breaker(
  p_run_id uuid,
  p_drift_halt numeric DEFAULT 0.75,
  p_max_errors int DEFAULT 3
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_tenant     uuid;
  v_budget     numeric;
  v_cost       numeric;
  v_unauth     int;
  v_max_drift  numeric;
  v_errors     int;
  v_reason     text;
  v_next_seq   int;
  v_event_id   uuid;
BEGIN
  SELECT r.tenant_id, t.max_budget_usd INTO v_tenant, v_budget
  FROM agent_runs r JOIN tasks t ON t.task_id = r.task_id
  WHERE r.run_id = p_run_id;

  SELECT coalesce(sum(cost_usd),0),
         count(*) FILTER (WHERE (raw_event->>'error') IS NOT NULL)
    INTO v_cost, v_errors
  FROM trace_events WHERE run_id = p_run_id;

  SELECT count(*) FILTER (WHERE check_type = 'unauthorized_tool'),
         coalesce(max(score),0)
    INTO v_unauth, v_max_drift
  FROM drift_checks WHERE run_id = p_run_id;

  v_reason := CASE
    WHEN v_unauth >= 1            THEN format('unauthorized tool used (%s)', v_unauth)
    WHEN v_cost > v_budget        THEN format('cost $%s exceeded budget $%s', round(v_cost,4), round(v_budget,4))
    WHEN v_max_drift > p_drift_halt THEN format('semantic drift %s exceeded halt threshold %s', round(v_max_drift,3), p_drift_halt)
    WHEN v_errors >= p_max_errors THEN format('error count %s reached limit %s', v_errors, p_max_errors)
    ELSE NULL
  END;

  IF v_reason IS NULL THEN
    RETURN NULL;  -- breaker not tripped
  END IF;

  SELECT coalesce(max(seq),0) + 1 INTO v_next_seq FROM trace_events WHERE run_id = p_run_id;
  v_event_id := gen_random_uuid();

  INSERT INTO trace_events (event_id, run_id, tenant_id, seq, event_type, output_text, raw_event)
  VALUES (v_event_id, p_run_id, v_tenant, v_next_seq, 'circuit_breaker_halt',
          'Run halted by circuit breaker: ' || v_reason,
          jsonb_build_object('reason', v_reason, 'halted_at', now()));

  PERFORM tj_append_to_chain(v_event_id);  -- the block is itself tamper-evident

  UPDATE agent_runs
     SET state = 'halted', halted_reason = v_reason
   WHERE run_id = p_run_id;

  RETURN v_reason;
END $$;

-- ============================================================================
-- COST-AFTER-DRIFT ATTRIBUTION  [X1] - window/FILTER aggregation in SQL.
-- "We don't just say it drifted - we show how much was spent after it did."
-- ============================================================================
CREATE OR REPLACE FUNCTION tj_cost_after_drift(p_run_id uuid)
RETURNS TABLE (
  total_cost        numeric,
  cost_before_drift numeric,
  cost_after_drift  numeric,
  first_drift_seq   int,
  wasted_pct        numeric
) LANGUAGE sql STABLE AS $$
  WITH first_drift AS (
    SELECT min(te.seq) AS seq
    FROM drift_checks dc
    JOIN trace_events te ON te.event_id = dc.evidence_event
    WHERE dc.run_id = p_run_id
  ),
  agg AS (
    SELECT
      coalesce(sum(te.cost_usd), 0) AS total_cost,
      coalesce(sum(te.cost_usd) FILTER (WHERE te.seq < (SELECT seq FROM first_drift)), 0) AS before_cost,
      coalesce(sum(te.cost_usd) FILTER (WHERE te.seq >= (SELECT seq FROM first_drift)), 0) AS after_cost
    FROM trace_events te
    WHERE te.run_id = p_run_id
  )
  SELECT
    agg.total_cost,
    agg.before_cost,
    agg.after_cost,
    (SELECT seq FROM first_drift),
    CASE WHEN agg.total_cost > 0
         THEN round(100 * agg.after_cost / agg.total_cost, 1)
         ELSE 0 END
  FROM agg;
$$;

-- Final grant pass: ensure every function defined above is executable by the app
-- role (covers re-applies where default privileges may not re-trigger).
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tracejudge_app;

-- ============================================================================
-- COMPLIANCE EVIDENCE EXPORT  [X4] - assemble an EU AI Act Article 12 audit
-- bundle entirely in SQL: WHO (agent) / WHAT (task policy) / WHEN (run) / WHY
-- (the verified hash chain) + findings + cost attribution + the full event log
-- with per-event hashes. A regulator can independently recompute the chain.
-- ============================================================================
CREATE OR REPLACE FUNCTION tj_compliance_export(p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'document', 'TraceJudge compliance evidence bundle',
    'standard', 'EU AI Act Article 12 - automatic recording of events (logging)',
    'generated_at', now(),
    'run_id', r.run_id,
    'tenant_id', r.tenant_id,
    'verdict', r.verdict,
    'who', jsonb_build_object(
      'agent_id', a.agent_id, 'agent_name', a.name, 'owner', a.owner,
      'risk_level', a.risk_level, 'policy_version', a.policy_version
    ),
    'what', jsonb_build_object(
      'assigned_goal', t.assigned_goal, 'allowed_tools', t.allowed_tools,
      'required_steps', t.required_steps, 'prohibited_actions', t.prohibited_actions,
      'prohibited_data', t.prohibited_data, 'max_budget_usd', t.max_budget_usd
    ),
    'when', jsonb_build_object(
      'started_at', r.started_at, 'state', r.state, 'halted_reason', r.halted_reason
    ),
    'why_trustworthy', jsonb_build_object(
      'algorithm', 'sha256(prev_hash || canonical(event))',
      'verified', (SELECT bool_and(ok) FROM tj_verify_chain(p_run_id)),
      'chain_length', (SELECT count(*) FROM tj_verify_chain(p_run_id)),
      'last_hash', (SELECT stored_hash FROM tj_verify_chain(p_run_id) ORDER BY seq DESC LIMIT 1)
    ),
    'cost_attribution', (SELECT to_jsonb(c) FROM tj_cost_after_drift(p_run_id) c),
    'findings', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'check_type', dc.check_type, 'severity', dc.severity,
        'score', dc.score, 'explanation', dc.explanation,
        'evidence_seq', (SELECT seq FROM trace_events te WHERE te.event_id = dc.evidence_event)
      ) ORDER BY dc.severity DESC), '[]'::jsonb)
      FROM drift_checks dc WHERE dc.run_id = p_run_id
    ),
    'events', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'seq', te.seq, 'event_type', te.event_type, 'tool_name', te.tool_name,
        'model', te.model, 'input_tokens', te.input_tokens, 'output_tokens', te.output_tokens,
        'cost_usd', te.cost_usd, 'output_text', te.output_text, 'raw_event', te.raw_event,
        'created_at', te.created_at, 'prev_hash', ac.prev_hash, 'current_hash', ac.current_hash
      ) ORDER BY te.seq), '[]'::jsonb)
      FROM trace_events te LEFT JOIN audit_chain ac ON ac.event_id = te.event_id
      WHERE te.run_id = p_run_id
    )
  )
  FROM agent_runs r
  JOIN tasks t ON t.task_id = r.task_id
  JOIN agents a ON a.agent_id = t.agent_id
  WHERE r.run_id = p_run_id;
$$;
GRANT EXECUTE ON FUNCTION tj_compliance_export(uuid) TO tracejudge_app;
