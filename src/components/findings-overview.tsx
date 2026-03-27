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
}

export function FindingsOverview({
  findings,
  filteredCount,
  activeSignal,
  activeSeverity,
  onSignalChange,
  onSeverityChange,
}: FindingsOverviewProps) {
  const signalSummary = summarizeFindingSignals(findings);
  const severityCounts = severityOrder.map((severity) => ({
    severity,
    count: findings.filter((finding) => finding.severity === severity).length,
  }));
  const filtersActive = activeSignal !== "all" || activeSeverity !== "all";

  return (
    <section className="sf-panel">
      <div className="sf-panel-header">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="sf-kicker">
              Findings overview
            </div>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Group the run by the kind of operator attention it needs, then
              narrow the table without losing the full evidence trail.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-on-surface-variant">
            {filteredCount} of {findings.length}
          </span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {signalSummary.map((item) => {
            const selected = activeSignal === item.signal;
            const muted = item.count === 0;
            return (
              <button
                key={item.signal}
                type="button"
                className={`cursor-pointer rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
                  selected
                    ? "border-primary/30 bg-primary/[0.07] shadow-sm"
                    : "border-outline-variant/15 bg-surface-container-low hover:border-outline-variant/25 hover:bg-surface-container hover:shadow-sm"
                } ${muted ? "opacity-60" : ""}`}
                onClick={() => onSignalChange(selected ? "all" : item.signal)}
                aria-pressed={selected}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="sf-kicker text-outline-variant">
                      {item.label}
                    </div>
                    <div className="mt-1 text-lg font-bold leading-none text-on-surface">
                      {item.count}
                    </div>
                  </div>
                  {item.highestSeverity ? (
                    <SeverityBadge severity={item.highestSeverity} />
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                      Clear
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
                  {item.description}
                </p>
                {item.sampleTitle ? (
                  <div className="mt-3 rounded-md border border-outline-variant/10 bg-surface-container-lowest px-2.5 py-2 text-xs leading-relaxed text-on-surface">
                    {item.sampleTitle}
                  </div>
                ) : (
                  <div className="mt-3 text-xs font-medium text-outline-variant">
                    No findings in this bucket.
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sf-kicker text-outline-variant">
              Filter by signal
            </span>
            <button
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeSignal === "all"
                  ? "border-primary/30 bg-primary/[0.08] text-primary"
                  : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
              }`}
              onClick={() => onSignalChange("all")}
            >
              All findings
            </button>
            {FINDING_SIGNAL_DEFINITIONS.map((definition) => (
              <button
                key={definition.signal}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeSignal === definition.signal
                    ? "border-primary/30 bg-primary/[0.08] text-primary"
                    : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                }`}
                onClick={() => onSignalChange(definition.signal)}
              >
                {definition.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="sf-kicker text-outline-variant">
              Filter by severity
            </span>
            <button
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeSeverity === "all"
                  ? "border-primary/30 bg-primary/[0.08] text-primary"
                  : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
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
                    : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
              <p className="text-xs leading-relaxed text-on-surface-variant">
                Showing {filteredCount} of {findings.length} findings with{" "}
                <span className="font-semibold text-on-surface">
                  {activeSignal === "all" ? "all signal buckets" : FINDING_SIGNAL_DEFINITIONS.find((item) => item.signal === activeSignal)?.label}
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
