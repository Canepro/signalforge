import type { RunDetail } from "@/types/api";

interface RunMetadataPanelProps {
  run: RunDetail;
}

export function RunMetadataPanel({ run }: RunMetadataPanelProps) {
  const numberFormatter = new Intl.NumberFormat("en-US");
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Run ID", value: run.id.slice(0, 8) },
    { label: "Artifact Type", value: run.artifact_type },
    { label: "Source", value: run.source_type },
    { label: "Target ID", value: run.target_identifier },
    { label: "Source label", value: run.source_label },
    { label: "Collector", value: run.collector_type },
    { label: "Collector version", value: run.collector_version },
    {
      label: "Collected at",
      value: run.collected_at
        ? new Date(run.collected_at).toLocaleString()
        : null,
    },
    { label: "Model", value: run.model_used ?? "deterministic-only" },
    {
      label: "Analysis Time",
      value: run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : null,
    },
    {
      label: "Tokens Used",
      value: run.tokens_used ? numberFormatter.format(run.tokens_used) : null,
    },
    {
      label: "Incomplete",
      value: run.is_incomplete ? (run.incomplete_reason ?? "Yes") : null,
    },
    { label: "Error", value: run.analysis_error },
  ];

  const visibleRows = rows.filter((r) => r.value !== null);

  return (
    <div className="rounded-lg border border-surface-container bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase text-on-surface-variant mb-3 flex items-center gap-2">
        <svg
          className="h-4 w-4 text-outline-variant"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Run Metadata
      </h3>
      <div className="grid grid-cols-2 gap-y-2 text-[10px]">
        {visibleRows.map((r) => (
          <div key={r.label} className="contents">
            <div className="text-outline-variant">{r.label}</div>
            <div className="text-on-surface-variant font-mono text-right">
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
