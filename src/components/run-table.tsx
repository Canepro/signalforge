import Link from "next/link";
import { SeverityBar } from "./severity-badge";
import { StatusBadge } from "./status-badge";
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
      <div className="overflow-x-auto">
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
                    {run.source_type}
                  </div>
                  <div className="text-[10px] text-on-surface-variant">
                    {run.artifact_type.replace(/-/g, " ")}
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
