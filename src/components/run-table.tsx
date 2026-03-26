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
      <div className="flex flex-col items-center justify-center rounded-lg bg-surface-container-lowest px-6 py-16 shadow-sm">
        <div className="text-sm font-medium text-on-surface-variant">
          No runs yet
        </div>
        <div className="mt-1 text-[10px] text-outline-variant">
          Upload an artifact to begin analysis
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-surface-container-lowest shadow-sm flex flex-col">
      <div className="px-6 py-3 flex items-center justify-between border-b border-surface-container">
        <h4 className="font-headline font-bold text-on-surface text-sm">
          Recent Diagnostic Runs
        </h4>
        <span className="text-xs font-bold text-primary">
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
                  className="text-sm font-semibold text-on-surface transition-colors hover:text-primary"
                >
                  {run.filename.replace(/\.(log|txt|json)$/i, "")}
                </Link>
                <div className="mt-1 font-mono text-[11px] text-outline-variant break-all">
                  {run.filename}
                </div>
              </div>
              <StatusBadge status={run.status} />
            </div>

            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 font-semibold text-on-surface">
                {getArtifactTypeLabel(run.artifact_type)}
              </span>
              <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 text-on-surface-variant">
                {getSourceTypeLabel(run.source_type)}
              </span>
              <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 text-on-surface-variant">
                {run.created_at_label ?? run.created_at}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="space-y-1 text-[11px] text-on-surface-variant">
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
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Run Name
              </th>
              <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
                Target
              </th>
              <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant hidden lg:table-cell">
                Source
              </th>
              <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Time
              </th>
              <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Severity
              </th>
              <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {runs.map((run) => (
              <tr
                key={run.id}
                className="hover:bg-surface-container-low/50 transition-colors"
              >
                <td className="px-6 py-3.5">
                  <Link
                    href={`/runs/${run.id}`}
                    className="text-sm font-semibold text-on-surface hover:text-primary transition-colors"
                  >
                    {run.filename.replace(/\.(log|txt|json)$/i, "")}
                  </Link>
                  <div className="font-mono text-[10px] text-outline-variant mt-0.5">
                    {run.filename}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 lg:hidden">
                    <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2 py-0.5 text-[10px] font-semibold text-on-surface">
                      {getArtifactTypeLabel(run.artifact_type)}
                    </span>
                    <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2 py-0.5 text-[10px] text-on-surface-variant">
                      {getSourceTypeLabel(run.source_type)}
                    </span>
                  </div>
                  {run.target_identifier || run.hostname ? (
                    <div className="mt-2 text-[10px] text-on-surface-variant md:hidden">
                      <span className="font-semibold text-on-surface">Target:</span>{" "}
                      <span className="break-all">{run.target_identifier ?? run.hostname}</span>
                    </div>
                  ) : null}
                </td>
                <td className="px-6 py-3.5 hidden md:table-cell">
                  {run.hostname || run.target_identifier ? (
                    <div>
                      {run.hostname ? (
                        <div className="text-[11px] font-bold text-on-surface">
                          {run.hostname}
                        </div>
                      ) : null}
                      {run.target_identifier ? (
                        <div className="text-[10px] font-mono text-on-surface-variant">
                          id: {run.target_identifier}
                        </div>
                      ) : null}
                      {run.env_tags.length > 0 && (
                        <div className="text-[10px] text-on-surface-variant">
                          {run.env_tags.join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-outline-variant">—</span>
                  )}
                </td>
                <td className="px-6 py-3.5 hidden lg:table-cell">
                  <div className="text-[11px] font-bold text-on-surface">
                    {getSourceTypeLabel(run.source_type)}
                  </div>
                  <div className="text-[10px] text-on-surface-variant">
                    {getArtifactTypeLabel(run.artifact_type)}
                  </div>
                </td>
                <td className="px-6 py-3.5 text-xs text-on-surface-variant whitespace-nowrap">
                  {run.created_at_label ?? run.created_at}
                </td>
                <td className="px-6 py-3.5">
                  <SeverityBar counts={run.severity_counts} />
                </td>
                <td className="px-6 py-3.5">
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
