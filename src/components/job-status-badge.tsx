const jobStatusConfig: Record<string, { className: string; icon: string; border: string }> = {
  queued: {
    className: "bg-severity-medium/10 text-severity-medium",
    border: "border-l-severity-medium",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  claimed: {
    className: "bg-secondary/10 text-secondary",
    border: "border-l-secondary",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  },
  running: {
    className: "bg-primary/15 text-primary",
    border: "border-l-primary",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  submitted: {
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    border: "border-l-emerald-500",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  failed: {
    className: "bg-severity-critical/10 text-severity-critical",
    border: "border-l-severity-critical",
    icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  expired: {
    className: "bg-severity-critical/10 text-severity-critical",
    border: "border-l-severity-critical",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  cancelled: {
    className: "bg-surface-container text-on-surface-variant",
    border: "border-l-outline-variant",
    icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
  },
};

export function JobStatusBadge({ status }: { status: string }) {
  const cfg = jobStatusConfig[status] ?? {
    className: "bg-surface-container text-on-surface-variant",
    border: "border-l-outline-variant",
    icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cfg.className}`}
    >
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
      </svg>
      {status}
    </span>
  );
}

export function jobBorderClass(status: string): string {
  return jobStatusConfig[status]?.border ?? "border-l-outline-variant";
}
