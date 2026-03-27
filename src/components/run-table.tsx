"use client";

import Link from "next/link";
import { useState } from "react";
import { SeverityBar } from "./severity-badge";
import { StatusBadge } from "./status-badge";
import { getArtifactTypeLabel, getSourceTypeLabel } from "@/lib/source-catalog";
import type { RunSummary } from "@/types/api";

const DEFAULT_VISIBLE = 12;

interface RunTableProps {
  runs: RunSummary[];
}

export function RunTable({ runs }: RunTableProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = runs.length > DEFAULT_VISIBLE;
  const visibleRuns = expanded ? runs : runs.slice(0, DEFAULT_VISIBLE);

  if (runs.length === 0) {
    return (
      <div className="sf-empty-state flex flex-col items-center justify-center px-6 py-12">
        <div className="text-sm font-medium text-on-surface-variant">
          No runs yet
        </div>
        <div className="mt-1 text-xs text-outline-variant">
          Upload an artifact to begin analysis
        </div>
      </div>
    );
  }

  return (
    <div className="sf-panel flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-low/70 px-4 py-3">
        <div>
          <p className="sf-kicker">Primary queue</p>
          <h4 className="font-headline text-sm font-bold tracking-tight text-on-surface">
            Recent Diagnostic Runs
          </h4>
        </div>
        <span className="text-xs font-semibold text-primary">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>

      <div className="divide-y divide-surface-container-low md:hidden">
        {visibleRuns.map((run) => (
          <div key={run.id} className="space-y-2.5 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/runs/${run.id}`}
                  className="text-sm font-semibold text-on-surface transition-colors hover:text-primary"
                >
                  {run.filename.replace(/\.(log|txt|json)$/i, "")}
                </Link>
                <div className="mt-0.5 font-mono text-xs text-outline-variant break-all">
                  {run.filename}
                </div>
              </div>
              <StatusBadge status={run.status} />
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-on-surface-variant">
              <span>{getArtifactTypeLabel(run.artifact_type)}</span>
              <span>{getSourceTypeLabel(run.source_type)}</span>
              <span>{run.created_at_label ?? run.created_at}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="space-y-1 text-xs text-on-surface-variant">
                <div>
                  <span className="font-semibold text-on-surface">Target:</span>{" "}
                  <span className="break-all">{run.target_identifier ?? run.hostname ?? "Not recorded"}</span>
                </div>
                {run.hostname && run.target_identifier ? (
                  <div>
                    <span className="font-semibold text-on-surface">Hostname:</span>{" "}
                    {run.hostname}
                  </div>
                ) : null}
                {run.env_tags.length > 0 ? (
                  <div>
                    <span className="font-semibold text-on-surface">Tags:</span>{" "}
                    {run.env_tags.join(" · ")}
                  </div>
                ) : null}
              </div>
              <div className="min-w-[140px]">
                <SeverityBar counts={run.severity_counts} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="w-[28%] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Run
              </th>
              <th className="hidden w-[28%] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant md:table-cell">
                Target
              </th>
              <th className="hidden w-[14%] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant lg:table-cell">
                Source
              </th>
              <th className="w-[12%] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Collected
              </th>
              <th className="w-[10%] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Severity
              </th>
              <th className="w-[8%] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant xl:hidden">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {visibleRuns.map((run) => (
              <tr
                key={run.id}
                className="sf-table-row align-top"
              >
                <td className="px-3 py-3">
                  <Link
                    href={`/runs/${run.id}`}
                    className="text-sm font-semibold text-on-surface transition-colors hover:text-primary"
                  >
                    {run.filename.replace(/\.(log|txt|json)$/i, "")}
                  </Link>
                  <div className="mt-0.5 truncate font-mono text-xs text-outline-variant">
                    {run.filename}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-on-surface-variant lg:hidden">
                    <span>{getArtifactTypeLabel(run.artifact_type)}</span>
                    <span>{getSourceTypeLabel(run.source_type)}</span>
                  </div>
                  {run.target_identifier || run.hostname ? (
                    <div className="mt-1.5 truncate text-xs text-on-surface-variant md:hidden">
                      <span className="font-semibold text-on-surface">Target:</span>{" "}
                      {run.target_identifier ?? run.hostname}
                    </div>
                  ) : null}
                </td>
                <td className="hidden px-3 py-3 md:table-cell">
                  {run.hostname || run.target_identifier ? (
                    <div className="min-w-0">
                      {run.hostname ? (
                        <div className="truncate text-sm font-semibold text-on-surface">
                          {run.hostname}
                        </div>
                      ) : null}
                      {run.target_identifier ? (
                        <div className="mt-0.5 truncate text-xs font-mono text-on-surface-variant">
                          id: {run.target_identifier}
                        </div>
                      ) : null}
                      {run.env_tags.length > 0 && (
                        <div className="mt-0.5 text-xs text-on-surface-variant">
                          {run.env_tags.join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-outline-variant">—</span>
                  )}
                </td>
                <td className="hidden px-3 py-3 lg:table-cell">
                  <div className="text-sm font-semibold text-on-surface">
                    {getSourceTypeLabel(run.source_type)}
                  </div>
                  <div className="mt-0.5 text-xs text-on-surface-variant">
                    {getArtifactTypeLabel(run.artifact_type)}
                  </div>
                </td>
                <td className="px-3 py-3 text-sm text-on-surface-variant whitespace-nowrap">
                  {run.created_at_label ?? run.created_at}
                </td>
                <td className="px-3 py-3">
                  <SeverityBar counts={run.severity_counts} />
                </td>
                <td className="px-3 py-3 xl:hidden">
                  <StatusBadge status={run.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t border-outline-variant/15 bg-surface-container-low/40 px-4 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-surface-container-low"
        >
          {expanded ? "Show fewer" : `Show all ${runs.length} runs`}
          <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
