import Link from "next/link";
import { SeverityBar } from "./severity-badge";
import { StatusBadge } from "./status-badge";
import { getArtifactTypeLabel, getSourceTypeLabel } from "@/lib/source-catalog";
import type { RunSummary } from "@/types/api";

interface RunTableProps {
  runs: RunSummary[];
}

export function RunTable({ runs }: RunTableProps) {
  if (runs.length === 0) {
    return (
      <div className="sf-empty-state flex flex-col items-center justify-center px-6 py-16">
        <div className="text-base font-medium text-on-surface-variant">
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
      <div className="flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-low/70 px-5 py-4">
        <div>
          <p className="sf-kicker">Primary queue</p>
          <h4 className="font-headline text-base font-bold tracking-tight text-on-surface">
            Recent Diagnostic Runs
          </h4>
        </div>
        <span className="text-sm font-semibold text-primary">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>
      <div className="divide-y divide-surface-container-low md:hidden">
        {runs.map((run) => (
          <div key={run.id} className="space-y-3 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/runs/${run.id}`}
                  className="text-base font-semibold text-on-surface transition-colors hover:text-primary"
                >
                  {run.filename.replace(/\.(log|txt|json)$/i, "")}
                </Link>
                <div className="mt-1 font-mono text-xs text-outline-variant break-all">
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
              <div className="min-w-[160px]">
                <SeverityBar counts={run.severity_counts} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Run
              </th>
              <th className="hidden px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant md:table-cell">
                Target
              </th>
              <th className="hidden px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant lg:table-cell">
                Source
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Collected
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Severity
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {runs.map((run) => (
              <tr
                key={run.id}
                className="sf-table-row align-top"
              >
                <td className="px-5 py-4">
                  <Link
                    href={`/runs/${run.id}`}
                    className="text-sm font-semibold text-on-surface transition-colors hover:text-primary"
                  >
                    {run.filename.replace(/\.(log|txt|json)$/i, "")}
                  </Link>
                  <div className="mt-1 font-mono text-xs text-outline-variant">
                    {run.filename}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-on-surface-variant lg:hidden">
                    <span>{getArtifactTypeLabel(run.artifact_type)}</span>
                    <span>{getSourceTypeLabel(run.source_type)}</span>
                  </div>
                  {run.target_identifier || run.hostname ? (
                    <div className="mt-2 text-xs text-on-surface-variant md:hidden">
                      <span className="font-semibold text-on-surface">Target:</span>{" "}
                      <span className="break-all">{run.target_identifier ?? run.hostname}</span>
                    </div>
                  ) : null}
                </td>
                <td className="hidden px-5 py-4 md:table-cell">
                  {run.hostname || run.target_identifier ? (
                    <div>
                      {run.hostname ? (
                        <div className="text-sm font-semibold text-on-surface">
                          {run.hostname}
                        </div>
                      ) : null}
                      {run.target_identifier ? (
                        <div className="mt-1 text-xs font-mono text-on-surface-variant">
                          id: {run.target_identifier}
                        </div>
                      ) : null}
                      {run.env_tags.length > 0 && (
                        <div className="mt-1 text-xs text-on-surface-variant">
                          {run.env_tags.join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-outline-variant">—</span>
                  )}
                </td>
                <td className="hidden px-5 py-4 lg:table-cell">
                  <div className="text-sm font-semibold text-on-surface">
                    {getSourceTypeLabel(run.source_type)}
                  </div>
                  <div className="mt-1 text-xs text-on-surface-variant">
                    {getArtifactTypeLabel(run.artifact_type)}
                  </div>
                </td>
                <td className="px-5 py-4 text-sm text-on-surface-variant whitespace-nowrap">
                  {run.created_at_label ?? run.created_at}
                </td>
                <td className="px-5 py-4">
                  <SeverityBar counts={run.severity_counts} />
                </td>
                <td className="px-5 py-4">
                  <StatusBadge status={run.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
