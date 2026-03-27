type Severity = "critical" | "high" | "medium" | "low";

const dotColors: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
};

const textColors: Record<Severity, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
};

const barColors: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-outline-variant",
};

interface SeverityBadgeProps {
  severity: string;
  count?: number;
}

export function SeverityBadge({ severity, count }: SeverityBadgeProps) {
  const sev = severity as Severity;
  const dot = dotColors[sev] ?? dotColors.low;
  const text = textColors[sev] ?? textColors.low;

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className={`text-xs font-bold uppercase ${text}`}>
        {severity}
      </span>
      {count !== undefined && (
        <span className="text-xs font-bold text-on-surface-variant">
          ({count})
        </span>
      )}
    </div>
  );
}

interface SeveritySummaryProps {
  counts: Record<string, number>;
  compact?: boolean;
}

export function SeveritySummary({ counts, compact }: SeveritySummaryProps) {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  const visible = order.filter((s) => (counts[s] ?? 0) > 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (visible.length === 0) {
    return <span className="text-xs text-outline-variant">No findings</span>;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1 rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm">
        <div className="border-r border-outline-variant/10 px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
            Findings
          </div>
          <div className="mt-0.5 text-base font-headline font-bold leading-none text-on-surface">
            {total}
          </div>
        </div>
        {order.map((sev) => {
          const c = counts[sev] ?? 0;
          if (c === 0) return null;
          return (
            <div key={sev} className="px-2.5 py-2.5 text-center">
              <div
                className={`text-base font-headline font-bold leading-none ${textColors[sev]}`}
              >
                {c}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-outline-variant">
                {sev}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((sev) => (
        <SeverityBadge key={sev} severity={sev} count={counts[sev]} />
      ))}
    </div>
  );
}

interface SeverityBarProps {
  counts: Record<string, number>;
}

export function SeverityBar({ counts }: SeverityBarProps) {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  const total = order.reduce((a, s) => a + (counts[s] ?? 0), 0);

  if (total === 0) {
    return (
      <div className="h-1.5 w-24 rounded-full bg-surface-container-highest" />
    );
  }

  return (
    <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-container-highest">
      {order.map((sev) => {
        const c = counts[sev] ?? 0;
        if (c === 0) return null;
        const pct = (c / total) * 100;
        return (
          <div
            key={sev}
            className={barColors[sev]}
            style={{ width: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}
