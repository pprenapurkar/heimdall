import Link from "next/link";
import { getRun } from "@/lib/runs";
import { DEMO_TENANT } from "@/lib/tenant";
import { VerdictPill, SeverityPill } from "@/components/VerdictPill";
import { AuditPanel } from "@/components/RunActions";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: { runId: string } }) {
  const run = await getRun(params.runId, DEMO_TENANT);
  if (!run) {
    return (
      <div className="container">
        <Link href="/" className="back">← all runs</Link>
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="muted">Run not found.</p>
        </div>
      </div>
    );
  }

  const { summary, cost, drift, audit, timeline } = run;
  // Map evidence events to their findings for inline annotation.
  const findingByEvent = new Map<string, typeof drift>();
  for (const d of drift) {
    if (!d.evidence_event) continue;
    const arr = findingByEvent.get(d.evidence_event) ?? [];
    arr.push(d);
    findingByEvent.set(d.evidence_event, arr);
  }

  return (
    <div className="container">
      <Link href="/" className="back">← all runs</Link>

      <div className="row spread" style={{ margin: "14px 0 6px" }}>
        <div className="brand" style={{ margin: 0 }}>
          <h1 style={{ fontSize: 19 }}>{summary.label ?? "Run"}</h1>
          <span className="tag mono small">{summary.run_id}</span>
        </div>
        <VerdictPill verdict={summary.verdict} />
      </div>
      {summary.halted_reason && (
        <div className="notice bad" style={{ marginBottom: 14 }}>
          ⛔ Circuit breaker halted this run: {summary.halted_reason}
        </div>
      )}

      {/* Declared intent (C1) */}
      <div className="panel">
        <h2>Declared intent (policy-as-data)</h2>
        <div className="kv">
          <div className="k">Agent</div>
          <div>{summary.agent_name} · state {summary.state}</div>
          <div className="k">Assigned goal</div>
          <div>{run.goal}</div>
          <div className="k">Allowed tools</div>
          <div>{run.allowed_tools.map((t) => <span key={t} className="tag-chip">{t}</span>)}</div>
          <div className="k">Required steps</div>
          <div>{run.required_steps.map((t) => <span key={t} className="tag-chip">{t}</span>)}</div>
          <div className="k">Prohibited</div>
          <div>{run.prohibited_actions.map((t) => <span key={t} className="tag-chip">{t}</span>)}</div>
        </div>
      </div>

      {/* Cost after drift (X1) */}
      <div className="panel">
        <h2>Cost-after-drift attribution (SQL window / FILTER)</h2>
        <div className="stat">
          <div><div className="n">${cost.total_cost.toFixed(2)}</div><div className="l">total run cost</div></div>
          <div><div className="n">${cost.cost_before_drift.toFixed(2)}</div><div className="l">spent before drift</div></div>
          <div><div className="n" style={{ color: cost.cost_after_drift > 0 ? "var(--red)" : undefined }}>
            ${cost.cost_after_drift.toFixed(2)}</div><div className="l">spent AFTER drift</div></div>
          <div><div className="n" style={{ color: cost.wasted_pct > 0 ? "var(--red)" : "var(--green)" }}>
            {cost.wasted_pct}%</div><div className="l">of spend wasted post-drift</div></div>
          <div><div className="n">{cost.first_drift_seq ?? "—"}</div><div className="l">first drift at step</div></div>
        </div>
      </div>

      {/* Drift findings (C3) */}
      <div className="panel">
        <h2>Drift findings (deterministic rules + pgvector)</h2>
        {drift.length === 0 ? (
          <div className="notice ok">No drift. Every action stayed within declared policy and on-goal.</div>
        ) : (
          drift.map((d) => (
            <div key={d.check_id} className={`finding ${d.severity}`}>
              <div className="row spread">
                <span className="ftype">{d.check_type}</span>
                <SeverityPill severity={d.severity} />
              </div>
              <div className="small" style={{ marginTop: 5 }}>{d.explanation}</div>
              {d.score !== null && (
                <div className="small muted mono" style={{ marginTop: 3 }}>
                  cosine distance {Number(d.score).toFixed(3)}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Trace timeline (C2 + C5) */}
      <div className="panel">
        <h2>Trace timeline (OTel GenAI-aligned, JSONB)</h2>
        <div className="timeline">
          {timeline.map((e) => {
            const findings = findingByEvent.get(e.event_id) ?? [];
            const isHalt = e.event_type === "circuit_breaker_halt";
            return (
              <div
                key={e.event_id}
                className={`tevent ${findings.length ? "drift" : ""} ${isHalt ? "halt" : ""}`}
              >
                <div className="row spread">
                  <div className="row">
                    <span className="seq">#{e.seq}</span>
                    <span className="etype">{e.event_type}</span>
                    {e.tool_name && <span className="tool">{e.tool_name}</span>}
                  </div>
                  {findings.length > 0 && (
                    <span className="pill red"><span className="dot" />drift point</span>
                  )}
                </div>
                {e.output_text && <div className="out">{e.output_text}</div>}
                <div className="meta">
                  {e.model && <>model {e.model} · </>}
                  {e.input_tokens != null && <>tokens {e.input_tokens}/{e.output_tokens} · </>}
                  cost ${Number(e.cost_usd).toFixed(2)}
                </div>
                {findings.map((f) => (
                  <div key={f.check_id} className="meta" style={{ color: "var(--red)" }}>
                    ↳ {f.check_type}: {f.explanation}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Audit chain (C4) */}
      <div className="panel">
        <h2>Tamper-evident audit chain (sha256 in SQL)</h2>
        <AuditPanel runId={summary.run_id} initial={audit} />
      </div>

      {/* Compliance export (X4) */}
      <div className="panel">
        <div className="row spread wrap">
          <div>
            <h2 style={{ margin: 0 }}>Compliance evidence bundle</h2>
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              EU AI Act Article 12 audit bundle — who / what / when / why (verified hash
              chain) + findings + cost attribution + per-event hashes, assembled in SQL.
            </p>
          </div>
          <a
            className="btn"
            href={`/api/runs/${summary.run_id}/export`}
            download={`tracejudge-art12-${summary.run_id}.json`}
          >
            ↓ Export Art. 12 bundle (JSON)
          </a>
        </div>
      </div>
    </div>
  );
}
