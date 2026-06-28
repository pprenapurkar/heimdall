"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface VerifyResult {
  verified: boolean;
  chain_length: number;
  last_hash: string | null;
  tampered_at: number | null;
}

export function AuditPanel({
  runId,
  initial,
}: {
  runId: string;
  initial: VerifyResult;
}) {
  const router = useRouter();
  const [result, setResult] = useState<VerifyResult>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function verify() {
    setBusy("verify");
    const res = await fetch(`/api/runs/${runId}/verify`, { method: "POST" });
    setResult(await res.json());
    setBusy(null);
  }

  async function tamper() {
    setBusy("tamper");
    const res = await fetch(`/api/runs/${runId}/tamper`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq: 2 }),
    });
    setResult(await res.json());
    setBusy(null);
    router.refresh();
  }

  async function reset() {
    setBusy("reset");
    await fetch(`/api/seed`, { method: "POST" });
    const res = await fetch(`/api/runs/${runId}/verify`, { method: "POST" });
    setResult(await res.json());
    setBusy(null);
    router.refresh();
  }

  return (
    <div>
      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div className="row">
          {result.verified ? (
            <span className="pill green">
              <span className="dot" /> Audit verified
            </span>
          ) : (
            <span className="pill red">
              <span className="dot" /> Tamper detected
            </span>
          )}
          <span className="muted small">
            chain length {result.chain_length}
            {result.tampered_at !== null && ` · first mismatch at seq ${result.tampered_at}`}
          </span>
        </div>
        <div className="row">
          <button className="btn" onClick={verify} disabled={!!busy}>
            {busy === "verify" ? "Verifying…" : "Re-verify chain"}
          </button>
          <button className="btn danger" onClick={tamper} disabled={!!busy}>
            {busy === "tamper" ? "Tampering…" : "Tamper (seq 2)"}
          </button>
          <button className="btn" onClick={reset} disabled={!!busy}>
            {busy === "reset" ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      </div>

      {result.last_hash && (
        <div className="small">
          <span className="muted">last hash&nbsp;</span>
          <span className="hash">{result.last_hash}</span>
        </div>
      )}

      {result.verified ? (
        <div className="notice ok">
          Recomputed sha256 chain matches stored hashes for all {result.chain_length} events.
          The record is provably unaltered (EU AI Act Art. 12).
        </div>
      ) : (
        <div className="notice bad">
          Recomputed hash diverges from the stored chain at seq {result.tampered_at}. An edit was
          made without re-signing — the tampering is exposed. Click “Reset demo” to restore.
        </div>
      )}
    </div>
  );
}

export function ResetButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/seed`, { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
