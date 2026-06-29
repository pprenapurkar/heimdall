import Link from "next/link";
import { listRuns, type RunSummary } from "@/lib/runs";
import { DEMO_TENANT } from "@/lib/tenant";
import { VerdictPill } from "@/components/VerdictPill";
import { ResetButton } from "@/components/RunActions";

export const dynamic = "force-dynamic";

export default async function Home() {
  let runs: RunSummary[] = [];
  let error: string | null = null;
  try {
    runs = await listRuns(DEMO_TENANT);
  } catch (e) {
    error = String(e);
  }

  return (
    <div className="container">
      <div className="brand">
        <h1>Heimdall</h1>
        <span className="tag">a flight recorder for autonomous AI agents, on Aurora PostgreSQL</span>
      </div>
      <p className="subhead">
        We don't use the database as storage - we use it as the agent control plane:
        trace store, semantic judge, policy engine, and tamper-evident audit ledger.
        Each run below was scored entirely in SQL (JSONB traces, pgvector similarity,
        relational policy rules, and a sha256 hash chain).
      </p>

      {error ? (
        <div className="panel">
          <div className="notice bad">
            Could not reach the database. Run <span className="mono">npm run db:reset</span> then
            reload. <br />
            <span className="small muted">{error}</span>
          </div>
        </div>
      ) : runs.length === 0 ? (
        <div className="panel">
          <p className="muted">No runs yet.</p>
          <ResetButton />
        </div>
      ) : (
        <>
          <div className="row spread" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
              AGENT RUNS ({runs.length})
            </h2>
            <ResetButton />
          </div>
          {runs.map((r) => (
            <Link key={r.run_id} href={`/runs/${r.run_id}`} className="runcard">
              <div className="row spread" style={{ marginBottom: 8 }}>
                <span className="title">{r.label ?? r.run_id}</span>
                <VerdictPill verdict={r.verdict} />
              </div>
              <div className="metrics">
                <span>agent <b>{r.agent_name}</b></span>
                <span>state <b>{r.state}</b></span>
                <span>events <b>{r.event_count}</b></span>
                <span>drift findings <b>{r.drift_count}</b></span>
                <span>cost <b>${r.total_cost.toFixed(2)}</b></span>
                {r.halted_reason && (
                  <span style={{ color: "var(--yellow)" }}>halted: {r.halted_reason}</span>
                )}
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
