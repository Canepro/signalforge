"use client";

import type {
  RunDetailSummaryBar,
  RunDetailSummaryCallout,
  RunDetailSummaryModule,
  RunDetailSummaryStat,
  RunDetailSummaryTone,
} from "@/types/api";

const tonePanelClasses: Record<RunDetailSummaryTone, string> = {
  critical: "border-danger/25 bg-danger/[0.04]",
  warning: "border-warning/25 bg-warning/[0.05]",
  neutral: "border-outline-variant/15 bg-surface-container-low",
};

const toneAccentClasses: Record<RunDetailSummaryTone, string> = {
  critical: "bg-danger",
  warning: "bg-warning",
  neutral: "bg-primary/55",
};

const toneChipClasses: Record<RunDetailSummaryTone, string> = {
  critical: "border-danger/20 bg-danger/[0.08] text-danger",
  warning: "border-warning/20 bg-warning/[0.08] text-warning",
  neutral: "border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant",
};

const prominencePanelClasses = {
  primary: "border-primary/18 bg-surface-container-lowest shadow-sm",
  supporting: "",
} as const;

const prominenceHeaderCopy = {
  primary: "Primary operator signal",
  supporting: "Operator summary",
} as const;

const toneBadgeLabel: Record<RunDetailSummaryTone, string> = {
  critical: "Needs action",
  warning: "Watch closely",
  neutral: "Stable context",
};

function StatCard({ stat }: { stat: RunDetailSummaryStat }) {
  return (
    <div className="rounded-lg border border-outline-variant/12 bg-surface-container-lowest px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
        {stat.label}
      </div>
      <div
        className={`mt-1 text-lg font-bold tracking-tight ${
          stat.mono ? "font-mono" : "text-on-surface"
        }`}
      >
        {stat.value}
      </div>
      {stat.detail ? (
        <div className="mt-1 text-xs leading-relaxed text-on-surface-variant">
          {stat.detail}
        </div>
      ) : null}
    </div>
  );
}

function SummaryBar({ bar }: { bar: RunDetailSummaryBar }) {
  const ratio = Math.max(0, Math.min(1, bar.maxValue > 0 ? bar.value / bar.maxValue : 0));
  return (
    <div className="rounded-lg border border-outline-variant/12 bg-surface-container-lowest px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-on-surface">{bar.label}</div>
          {bar.detail ? (
            <div className="mt-0.5 text-[11px] leading-snug text-on-surface-variant">
              {bar.detail}
            </div>
          ) : null}
        </div>
        <div
          className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${toneChipClasses[bar.tone ?? "neutral"]}`}
        >
          {bar.value_label}
        </div>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
        <div
          className={`h-full rounded-full ${toneAccentClasses[bar.tone ?? "neutral"]}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function SummaryCallout({ callout }: { callout: RunDetailSummaryCallout }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tonePanelClasses[callout.tone ?? "neutral"]}`}>
      <div className="text-sm font-semibold text-on-surface">{callout.title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">{callout.body}</div>
    </div>
  );
}

export function RunDetailSummaryModules({
  modules,
}: {
  modules: RunDetailSummaryModule[];
}) {
  if (modules.length === 0) return null;
  const primaryModules = modules.filter((module) => module.prominence === "primary");
  const supportingModules = modules.filter((module) => module.prominence !== "primary");
  const orderedModules = [...primaryModules, ...supportingModules];

  return (
    <section className="space-y-4">
      {orderedModules.map((module) => (
        <article
          key={module.id}
          className={`sf-panel overflow-hidden ${prominencePanelClasses[module.prominence]}`}
        >
          <div className="sf-panel-header">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="sf-kicker">{prominenceHeaderCopy[module.prominence]}</div>
                <h3
                  className={`mt-1 font-headline font-bold tracking-tight text-on-surface ${
                    module.prominence === "primary" ? "text-lg" : "text-base"
                  }`}
                >
                  {module.title}
                </h3>
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-on-surface-variant">
                  {module.summary}
                </p>
              </div>
              <div
                className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${toneChipClasses[module.tone]}`}
              >
                {toneBadgeLabel[module.tone]}
              </div>
            </div>
          </div>

          <div className={`px-4 py-3.5 ${module.prominence === "primary" ? "lg:px-5 lg:py-4.5" : ""}`}>
            {module.kind === "stat-grid" ? (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {module.stats.map((stat) => (
                  <StatCard key={`${module.id}-${stat.label}-${stat.value}`} stat={stat} />
                ))}
              </div>
            ) : null}

            {module.kind === "bar-list" ? (
              <div className="grid gap-2.5 xl:grid-cols-2">
                {module.bars.map((bar) => (
                  <SummaryBar key={`${module.id}-${bar.label}-${bar.value_label}`} bar={bar} />
                ))}
              </div>
            ) : null}

            {module.kind === "callout-list" ? (
              <div className="grid gap-2.5 xl:grid-cols-2">
                {module.callouts.map((callout) => (
                  <SummaryCallout
                    key={`${module.id}-${callout.title}-${callout.body}`}
                    callout={callout}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}
