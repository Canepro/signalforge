import { CopyTextButton } from "./copy-text-button";
import {
  getArtifactFamilyPresentation,
  getArtifactTypeLabel,
  getSourceTypeLabel,
} from "@/lib/source-catalog";
import type { RunDetail } from "@/types/api";

interface RunMetadataPanelProps {
  run: RunDetail;
}

type MetadataRow = {
  label: string;
  value: string | null;
  display: string | null;
  secondary?: string | null;
  copyable?: boolean;
  mono?: boolean;
};

type MetadataSection = {
  title: string;
  rows: MetadataRow[];
};

export function RunMetadataPanel({ run }: RunMetadataPanelProps) {
  const numberFormatter = new Intl.NumberFormat("en-US");
  const artifactFamily = getArtifactFamilyPresentation(run.artifact_type);
  const artifactFamilyLabel =
    artifactFamily?.label ?? getArtifactTypeLabel(run.artifact_type);

  const sections: MetadataSection[] = [
    {
      title: "Identity",
      rows: [
        {
          label: "Run ID",
          value: run.id,
          display: run.id.slice(0, 8),
          copyable: true,
          mono: true,
        },
        {
          label: "Artifact family",
          value: run.artifact_type,
          display: artifactFamilyLabel,
          secondary: artifactFamily?.description ?? null,
          mono: true,
        },
        {
          label: "Source type",
          value: run.source_type,
          display: getSourceTypeLabel(run.source_type),
          secondary: run.source_type,
        },
        {
          label: "Target ID",
          value: run.target_identifier,
          display: run.target_identifier,
          copyable: true,
          mono: true,
        },
        {
          label: "Source label",
          value: run.source_label,
          display: run.source_label,
          copyable: true,
          mono: true,
        },
      ],
    },
    {
      title: "Collection",
      rows: [
        {
          label: "Collector",
          value: run.collector_type,
          display: run.collector_type,
          copyable: true,
          mono: true,
        },
        {
          label: "Collector version",
          value: run.collector_version,
          display: run.collector_version,
          copyable: true,
          mono: true,
        },
        {
          label: "Collected at",
          value: run.collected_at,
          display: run.collected_at_label ?? run.collected_at,
        },
      ],
    },
    {
      title: "Analysis",
      rows: [
        {
          label: "Model",
          value: run.model_used ?? "deterministic-only",
          display: run.model_used ?? "deterministic-only",
          mono: true,
        },
        {
          label: "Analysis time",
          value: run.duration_ms
            ? `${(run.duration_ms / 1000).toFixed(1)}s`
            : null,
          display: run.duration_ms
            ? `${(run.duration_ms / 1000).toFixed(1)}s`
            : null,
          mono: true,
        },
        {
          label: "Tokens used",
          value: run.tokens_used
            ? numberFormatter.format(run.tokens_used)
            : null,
          display: run.tokens_used
            ? numberFormatter.format(run.tokens_used)
            : null,
          mono: true,
        },
        {
          label: "Incomplete",
          value: run.is_incomplete ? (run.incomplete_reason ?? "Yes") : null,
          display: run.is_incomplete ? (run.incomplete_reason ?? "Yes") : null,
        },
        {
          label: "Error",
          value: run.analysis_error,
          display: run.analysis_error,
        },
      ],
    },
  ];

  return (
    <div className="sf-panel p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold tracking-tight text-on-surface">
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

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 py-2.5"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              {section.title}
            </div>
            <dl className="mt-2 space-y-2">
              {section.rows.map((row) => {
                if (row.value === null) return null;
                const value = row.value;
                const display = row.display ?? value;

                return (
                  <div
                    key={row.label}
                    className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-2"
                  >
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                      {row.label}
                    </dt>
                    <dd className="mt-1 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className={`text-sm font-medium text-on-surface break-words ${
                            row.mono ? "font-mono" : ""
                          }`}
                        >
                          {display}
                        </div>
                        {row.secondary ? (
                          <div className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                            {row.secondary}
                          </div>
                        ) : null}
                      </div>
                      {row.copyable ? (
                        <CopyTextButton
                          value={value}
                          idleLabel="Copy"
                          doneLabel="Copied"
                          className="shrink-0 rounded-lg border border-outline-variant/20 bg-surface-container-low px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                        />
                      ) : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
