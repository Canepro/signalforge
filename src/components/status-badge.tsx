interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<
  string,
  {
    label: string;
    className: string;
    iconClassName: string;
    dotClassName: string;
    icon: string;
    live?: boolean;
  }
> = {
  complete: {
    label: "Completed",
    className: "border border-primary/20 bg-primary/[0.08] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-primary/10 text-primary",
    dotClassName: "bg-primary",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  error: {
    label: "Failed",
    className: "border border-severity-critical/15 bg-severity-critical/[0.08] text-severity-critical shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-severity-critical/10 text-severity-critical",
    dotClassName: "bg-severity-critical",
    icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  pending: {
    label: "Pending",
    className: "border border-status-pending/20 bg-status-pending/[0.08] text-status-pending shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-status-pending/10 text-status-pending",
    dotClassName: "bg-status-pending",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    live: true,
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: status,
    className: "border border-outline-variant/20 bg-surface-container-low text-on-surface-variant shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    iconClassName: "bg-surface-container text-on-surface-variant",
    dotClassName: "bg-outline-variant",
    icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${config.className}`}
    >
      <span className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {config.live ? (
          <span className={`absolute inline-flex h-full w-full rounded-full ${config.dotClassName} opacity-35 animate-ping`} />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${config.dotClassName}`} />
      </span>
      <svg
        className={`h-4 w-4 rounded-full p-[3px] ${config.iconClassName}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
      </svg>
      {config.label}
    </span>
  );
}
