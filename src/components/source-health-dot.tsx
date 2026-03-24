const healthConfig: Record<string, { ring: string; dot: string; label: string; glow?: string }> = {
  online: {
    ring: "border-emerald-500/30",
    dot: "bg-emerald-500",
    label: "Online",
    glow: "shadow-[0_0_6px_rgba(16,185,129,0.5)]",
  },
  degraded: {
    ring: "border-amber-500/30",
    dot: "bg-amber-500",
    label: "Degraded",
    glow: "shadow-[0_0_6px_rgba(245,158,11,0.4)]",
  },
  offline: {
    ring: "border-red-500/30",
    dot: "bg-red-500",
    label: "Offline",
  },
  unknown: {
    ring: "border-outline-variant/30",
    dot: "bg-outline-variant",
    label: "Unknown",
  },
};

export function SourceHealthDot({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
  const cfg = healthConfig[status] ?? healthConfig.unknown!;
  const isLive = status === "online" || status === "degraded";
  const dotSize = size === "lg" ? "h-3 w-3" : "h-2 w-2";
  const ringSize = size === "lg" ? "h-6 w-6" : "h-4.5 w-4.5";

  return (
    <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
      <span className={`inline-flex items-center justify-center rounded-full border-2 ${cfg.ring} ${ringSize}`}>
        <span
          className={`inline-block rounded-full ${dotSize} ${cfg.dot} ${cfg.glow ?? ""}`}
          style={isLive ? { animation: "healthPulse 3s ease-in-out infinite" } : undefined}
        />
      </span>
      {cfg.label}
    </span>
  );
}
