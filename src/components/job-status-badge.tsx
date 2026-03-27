const jobStatusConfig: Record<
  string,
  {
    label: string;
    className: string;
    iconClassName: string;
    dotClassName: string;
    icon: string;
    border: string;
    live?: boolean;
  }
> = {
  queued: {
    label: "Queued",
    className: "border border-status-pending/20 bg-status-pending/[0.08] text-status-pending shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-status-pending/10 text-status-pending",
    dotClassName: "bg-status-pending",
    border: "border-l-status-pending",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    live: true,
  },
  claimed: {
    label: "Claimed",
    className: "border border-secondary/20 bg-secondary/[0.08] text-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-secondary/10 text-secondary",
    dotClassName: "bg-secondary",
    border: "border-l-secondary",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    live: true,
  },
  running: {
    label: "Running",
    className: "border border-primary/20 bg-primary/[0.1] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-primary/10 text-primary",
    dotClassName: "bg-primary",
    border: "border-l-primary",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    live: true,
  },
  submitted: {
    label: "Submitted",
    className: "border border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dotClassName: "bg-emerald-500",
    border: "border-l-emerald-500",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  failed: {
    label: "Failed",
    className: "border border-severity-critical/15 bg-severity-critical/[0.08] text-severity-critical shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-severity-critical/10 text-severity-critical",
    dotClassName: "bg-severity-critical",
    border: "border-l-severity-critical",
    icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  expired: {
    label: "Expired",
    className: "border border-severity-critical/15 bg-severity-critical/[0.08] text-severity-critical shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-severity-critical/10 text-severity-critical",
    dotClassName: "bg-severity-critical",
    border: "border-l-severity-critical",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  cancelled: {
    label: "Cancelled",
    className: "border border-outline-variant/20 bg-surface-container-low text-on-surface-variant shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-surface-container text-on-surface-variant",
    dotClassName: "bg-outline-variant",
    border: "border-l-outline-variant",
    icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
  },
};

export function JobStatusBadge({ status }: { status: string }) {
  const cfg = jobStatusConfig[status] ?? {
    label: status.replace(/_/g, " "),
    className: "border border-outline-variant/20 bg-surface-container-low text-on-surface-variant shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-surface-container text-on-surface-variant",
    dotClassName: "bg-outline-variant",
    border: "border-l-outline-variant",
    icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.className}`}
    >
      <span className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {cfg.live ? (
          <span className={`absolute inline-flex h-full w-full rounded-full ${cfg.dotClassName} opacity-35 animate-ping`} />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dotClassName}`} />
      </span>
      <svg className={`h-4 w-4 shrink-0 rounded-full p-[3px] ${cfg.iconClassName}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
      </svg>
      {cfg.label}
    </span>
  );
}

export function jobBorderClass(status: string): string {
  return jobStatusConfig[status]?.border ?? "border-l-outline-variant";
}
