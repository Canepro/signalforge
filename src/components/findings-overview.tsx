"use client";

import type { Finding, Severity } from "@/lib/analyzer/schema";
import {
  FINDING_SIGNAL_DEFINITIONS,
  summarizeFindingSignals,
  type FindingSignal,
} from "@/lib/findings-presentation";
import { SeverityBadge } from "./severity-badge";

const severityOrder: Severity[] = ["critical", "high", "medium", "low"];

interface FindingsOverviewProps {
  findings: Finding[];
  filteredCount: number;
  activeSignal: FindingSignal | "all";
  activeSeverity: Severity | "all";
  onSignalChange: (signal: FindingSignal | "all") => void;
  onSeverityChange: (severity: Severity | "all") => void;
  /** Compact layout when run-detail summary modules already carry the operator story. */
  compact?: boolean;
}

export function FindingsOverview({
  findings,
  filteredCount,
  activeSignal,
  activeSeverity,
  onSignalChange,
  onSeverityChange,
  compact = false,
}: FindingsOverviewProps) {
  const signalSummary = summarizeFindingSignals(findings);
  const severityCounts = severityOrder.map((severity) => ({
    severity,
    count: findings.filter((finding) => finding.severity === severity).length,
  }));
  const filtersActive = activeSignal !== "all" || activeSeverity !== "all";
  const activeSignalLabel =
    activeSignal === "all"
      ? "All signal buckets"
      : (FINDING_SIGNAL_DEFINITIONS.find((item) => item.signal === activeSignal)?.label ?? activeSignal);

  if (compact) {
    return (
      <section className="rounded-xl border border-outline-variant/15 bg-surface-container-low/55 px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-muted">
              Findings table filters
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-on-surface-variant">
              {filteredCount} of {findings.length} visible
              {filtersActive ? (
                <>
                  {" "}
                  · {activeSignalLabel.toLowerCase()} ·{" "}
                  {activeSeverity === "all" ? "all severities" : activeSeverity}
                </>
              ) : null}
            </p>
          </div>
          {filtersActive ? (
            <button
              type="button"
              className="sf-btn-secondary shrink-0 px-3 py-1.5 text-xs"
              onClick={() => {
                onSignalChange("all");
                onSeverityChange("all");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {signalSummary.map((item) => {
            const selected = activeSignal === item.signal;
            return (
              <button
                key={item.signal}
                type="button"
                title={item.description}
                aria-pressed={selected}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? "border-primary/30 bg-primary/[0.08] text-primary"
                    : item.count > 0
                      ? "border-outline-variant/20 bg-surface-container-lowest text-on-surface hover:bg-surface-container"
                      : "border-outline-variant/10 bg-surface-container-lowest/80 text-on-surface-variant opacity-70"
                }`}
                onClick={() => onSignalChange(selected ? "all" : item.signal)}
              >
                {item.label} ({item.count})
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              activeSeverity === "all"
                ? "border-primary/30 bg-primary/[0.08] text-primary"
                : "border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant"
            }`}
            onClick={() => onSeverityChange("all")}
          >
            All severities
          </button>
          {severityCounts.map(({ severity, count }) => (
            <button
              key={severity}
              type="button"
              className={`rounded-lg border px-2 py-1 text-xs font-semibold transition-colors ${
                activeSeverity === severity
                  ? "border-primary/30 bg-primary/[0.08] text-primary"
                  : "border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant"
              } ${count === 0 ? "opacity-60" : ""}`}
              onClick={() => onSeverityChange(severity)}
            >
              <span className="inline-flex items-center gap-1.5">
                <SeverityBadge severity={severity} />
                <span>{count}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="sf-panel">
      <div className="sf-panel-header">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="sf-kicker">Findings table controls</div>
            <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
              Filter the findings table by signal or severity while keeping the current visible count in view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-muted">
            <span>{filteredCount} of {findings.length} visible</span>
            <span className="text-on-surface-muted/60">·</span>
            <span>{activeSignalLabel}</span>
            <span className="text-on-surface-muted/60">·</span>
            <span>{activeSeverity === "all" ? "All severities" : activeSeverity}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3.5 px-4 py-3.5">
        <div className="sf-kicker text-on-surface-muted">Filter by signal</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {signalSummary.map((item) => {
            const selected = activeSignal === item.signal;
            return (
              <button
                key={item.signal}
                type="button"
                title={item.description}
                aria-pressed={selected}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  selected
                    ? "border-primary/30 bg-primary/[0.07] shadow-sm"
                    : item.count > 0
                      ? "border-outline-variant/15 bg-surface-container-low hover:bg-surface-container"
                      : "border-outline-variant/10 bg-surface-container-low/60 opacity-70 hover:bg-surface-container-low/70"
                }`}
                onClick={() => onSignalChange(selected ? "all" : item.signal)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="sf-kicker text-on-surface-muted">{item.label}</div>
                    <div className="mt-1 text-base font-bold leading-none text-on-surface">
                      {item.count}
                    </div>
                  </div>
                  {item.highestSeverity ? (
                    <SeverityBadge severity={item.highestSeverity} />
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-muted">
                      Clear
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-3 rounded-xl border border-outline-variant/15 bg-surface-container-low/55 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sf-kicker text-on-surface-muted">Filter by severity</span>
            <button
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeSeverity === "all"
                  ? "border-primary/30 bg-primary/[0.08] text-primary"
                  : "border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-lowest"
              }`}
              onClick={() => onSeverityChange("all")}
            >
              All severities
            </button>
            {severityCounts.map(({ severity, count }) => (
              <button
                key={severity}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeSeverity === severity
                    ? "border-primary/30 bg-primary/[0.08] text-primary"
                    : "border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-lowest"
                } ${count === 0 ? "opacity-60" : ""}`}
                onClick={() => onSeverityChange(severity)}
              >
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={severity} />
                  <span className="text-on-surface-variant">{count}</span>
                </div>
              </button>
            ))}
          </div>

          {filtersActive ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-lowest px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Showing {filteredCount} of {findings.length} findings with{" "}
                <span className="font-semibold text-on-surface">
                  {activeSignalLabel.toLowerCase()}
                </span>{" "}
                and{" "}
                <span className="font-semibold text-on-surface">
                  {activeSeverity === "all" ? "all severities" : activeSeverity}
                </span>
                .
              </p>
              <button
                type="button"
                className="sf-btn-secondary px-3 py-2 text-xs"
                onClick={() => {
                  onSignalChange("all");
                  onSeverityChange("all");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
