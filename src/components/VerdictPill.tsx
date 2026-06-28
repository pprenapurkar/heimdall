export function VerdictPill({ verdict }: { verdict: string | null }) {
  const v = verdict ?? "neutral";
  const label =
    verdict === "green"
      ? "Compliant"
      : verdict === "yellow"
        ? "Drift (warn)"
        : verdict === "red"
          ? "Drift (critical)"
          : "Pending";
  return (
    <span className={`pill ${v}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  const cls = severity === "critical" ? "red" : severity === "warn" ? "yellow" : "neutral";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" />
      {severity}
    </span>
  );
}
