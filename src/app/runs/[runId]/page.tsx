import Link from "next/link";
import { getRun } from "@/lib/runs";
import { DEMO_TENANT } from "@/lib/tenant";
import { VerdictPill, SeverityPill } from "@/components/VerdictPill";
import { AuditPanel } from "@/components/RunActions";

export const dynamic = "force-dynamic";

// Render-safe number: tolerates strings/null/undefined (the Data API returns
// numerics as strings) so .toFixed never throws on the server.
function money(v: unknown): string {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export default async function RunPage({ params }: { params: { runId: string } }) {
  let run: Awaited<ReturnType<typeof getRun>> = null;
  try {
    run = await getRun(params.runId, DEMO_TENANT);
  } catch {
    run = null;
  }

  if (!run) {
    return (
      <div className="container">
        <Link href="/" className="back">&larr; all runs</Link>
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="muted">Run not found, or it could not be loaded.</p>
        </div>
      </div>
    );
  }

  // Defensive locals: never assume a field is present or correctly typed.
  const summary = run.summary ?? ({} as NonNullable<typeof run>["summary"]);
  const runId = summary.run_id ?? params.runId;
  const drift = asArray<NonNullable<typeof run>["drift"][number]>(run.drift);
  const timeline = asArray<NonNullable<typeof run>["timeline"][number]>(run.timeline);
  const allowedTools = asArray<string>(run.allowed_tools);
  const requiredSteps = asArray<string>(run.required_steps);
  const prohibited = asArray<string>(run.prohibited_actions);
  const cost = run.cost ?? {
    total_cost: 0,
    cost_before_drift: 0,
    cost_after_drift: 0,
    first_drift_seq: null,
    wasted_pct: 0,
  };
  const audit = run.audit ?? {
    verified: false,
    chain_length: 0,
    last_hash: null,
    tampered_at: null,
    rows: [],
  };

  // Map evidence events to their findings for inline annotation.
  const findingByEvent = new Map<string, typeof drift>();
  for (const d of drift) {
    if (!d?.evidence_event) continue;
    const arr = findingByEvent.get(d.evidence_event) ?? [];
    arr.push(d);
    findingByEvent.set(d.evidence_event, arr);
  }

  return (
    <div className="container">
      <Link href="/" className="back">&larr; all runs</Link>

      <div className="row spread" style={{ margin: "14px 0 6px" }}>
        <div className="brand" style={{ margin: 0 }}>
          <h1 style={{ fontSize: 19 }}>{summary.label ?? "Run"}</h1>
          <span className="tag mono small">{runId}</span>
        </div>
        <VerdictPill verdict={summary.verdict ?? null} />
      </div>
      {summary.halted_reason && (
        <div className="notice bad" style={{ marginBottom: 14 }}>
          Circuit breaker halted this run: {summary.halted_reason}
        </div>
      )}

      {/* Declared intent (C1) */}
      <div className="panel">
        <h2>Declared intent (policy-as-data)</h2>
        <div className="kv">
          <div className="k">Agent</div>
          <div>{summary.agent_name ?? "unknown"} &middot; state {summary.state ?? "unknown"}</div>
          <div className="k">Assigned goal</div>
          <div>{run.goal ?? "-"}</div>
          <div className="k">Allowed tools</div>
          <div>
            {allowedTools.length
              ? allowedTools.map((t) => <span key={t} className="tag-chip">{t}</span>)
              : <span className="muted small">-</span>}
          </div>
          <div className="k">Required steps</div>
          <div>
            {requiredSteps.length
              ? requiredSteps.map((t) => <span key={t} className="tag-chip">{t}</span>)
              : <span className="muted small">-</span>}
          </div>
          <div className="k">Prohibited</div>
          <div>
            {prohibited.length
              ? prohibited.map((t) => <span key={t} className="tag-chip">{t}</span>)
              : <span className="muted small">-</span>}
          </div>
        </div>
      </div>

      {/* Cost after drift (X1) */}
      <div className="panel">
        <h2>Cost-after-drift attribution (SQL window / FILTER)</h2>
        <div className="stat">
          <div><div className="n">${money(cost.total_cost)}</div><div className="l">total run cost</div></div>
          <div><div className="n">${money(cost.cost_before_drift)}</div><div className="l">spent before drift</div></div>
          <div><div className="n" style={{ color: Number(cost.cost_after_drift) > 0 ? "var(--red)" : undefined }}>
            ${money(cost.cost_after_drift)}</div><div className="l">spent AFTER drift</div></div>
          <div><div className="n" style={{ color: Number(cost.wasted_pct) > 0 ? "var(--red)" : "var(--green)" }}>
            {Number(cost.wasted_pct) || 0}%</div><div className="l">of spend wasted post-drift</div></div>
          <div><div className="n">{cost.first_drift_seq ?? "-"}</div><div className="l">first drift at step</div></div>
        </div>
      </div>

      {/* Drift findings (C3) */}
      <div className="panel">
        <h2>Drift findings (deterministic rules + pgvector)</h2>
        {drift.length === 0 ? (
          <div className="notice ok">No drift. Every action stayed within declared policy and on-goal.</div>
        ) : (
          drift.map((d, i) => (
            <div key={d.check_id ?? i} className={`finding ${d.severity ?? ""}`}>
              <div className="row spread">
                <span className="ftype">{d.check_type}</span>
                <SeverityPill severity={d.severity ?? "info"} />
              </div>
              <div className="small" style={{ marginTop: 5 }}>{d.explanation}</div>
              {d.score != null && (
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
          {timeline.map((e, i) => {
            const findings = findingByEvent.get(e.event_id) ?? [];
            const isHalt = e.event_type === "circuit_breaker_halt";
            return (
              <div
                key={e.event_id ?? i}
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
                  {e.model && <>model {e.model} &middot; </>}
                  {e.input_tokens != null && <>tokens {e.input_tokens}/{e.output_tokens} &middot; </>}
                  cost ${money(e.cost_usd)}
                </div>
                {findings.map((f, j) => (
                  <div key={f.check_id ?? j} className="meta" style={{ color: "var(--red)" }}>
                    {f.check_type}: {f.explanation}
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
        <AuditPanel runId={runId} initial={audit} />
      </div>

      {/* Compliance export (X4) */}
      <div className="panel">
        <div className="row spread wrap">
          <div>
            <h2 style={{ margin: 0 }}>Compliance evidence bundle</h2>
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              EU AI Act Article 12 audit bundle: who / what / when / why (verified hash
              chain) + findings + cost attribution + per-event hashes, assembled in SQL.
            </p>
          </div>
          <a
            className="btn"
            href={`/api/runs/${runId}/export`}
            download={`tracejudge-art12-${runId}.json`}
          >
            Export Art. 12 bundle (JSON)
          </a>
        </div>
      </div>
    </div>
  );
}
