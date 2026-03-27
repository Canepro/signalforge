"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import type { FindingsDriftResult } from "@/lib/compare/findings-diff";
import type {
  EvidenceDeltaPayload,
  EvidenceDeltaMetricRow,
  EvidenceDeltaStatus,
} from "@/lib/compare/evidence-delta";
import {
  buildOperationalEvidenceDeltaSections,
  classifyEvidenceMetricFocus,
  EVIDENCE_METRIC_FOCUS_DEFINITIONS,
  type EvidenceMetricFocus,
} from "@/lib/compare/evidence-delta-presentation";
import { RunEvidenceSections } from "@/components/run-evidence-sections";

export interface CompareRunHeader {
  id: string;
  filename: string;
  created_at_label: string;
  target_name: string | null;
}

interface CompareClientProps {
  current: CompareRunHeader;
  baseline: CompareRunHeader | null;
  drift: FindingsDriftResult;
  evidenceDelta: EvidenceDeltaPayload | null;
  targetMismatch?: boolean;
  baselineMissing?: boolean;
}

function statusLabel(s: FindingsDriftResult["rows"][0]["status"]): string {
  switch (s) {
    case "new":
      return "New";
    case "resolved":
      return "Resolved";
    case "severity_up":
      return "Severity ↑";
    case "severity_down":
      return "Severity ↓";
    default:
      return s;
  }
}

function statusPillClass(s: FindingsDriftResult["rows"][0]["status"]): string {
  switch (s) {
    case "new":
      return "bg-red-50 text-red-800 border-red-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "severity_up":
      return "bg-orange-50 text-orange-800 border-orange-200";
    case "severity_down":
      return "bg-sky-50 text-sky-800 border-sky-200";
    default:
      return "bg-surface-container-high text-on-surface-variant";
  }
}

function evidenceSnippet(text: string | null, max = 160): string {
  if (!text) return "—";
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function evidenceDeltaStatusLabel(status: EvidenceDeltaStatus): string {
  switch (status) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "changed":
      return "Changed";
    default:
      return "Unchanged";
  }
}

function prettyMetadataLabel(
  key: keyof EvidenceDeltaPayload["metadata"],
): string {
  switch (key) {
    case "filename":
      return "Filename";
    case "target_identifier":
      return "Target identifier";
    case "collected_at":
      return "Collected at";
    case "collector_type":
      return "Collector type";
    case "collector_version":
      return "Collector version";
    default:
      return key;
  }
}

export function CompareClient({
  current,
  baseline,
  drift,
  evidenceDelta,
  targetMismatch,
  baselineMissing,
}: CompareClientProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [activeMetricFocus, setActiveMetricFocus] = useState<EvidenceMetricFocus>("all");

  const title = useMemo(
    () =>
      baseline
        ? `Drift: ${baseline.filename} → ${current.filename}`
        : "Compare runs",
    [baseline, current.filename],
  );

  const changedMetadata = useMemo(
    () =>
      evidenceDelta
        ? Object.entries(evidenceDelta.metadata).filter(
            ([, status]) => status !== "unchanged",
          )
        : [],
    [evidenceDelta],
  );
  const operationalDeltaSections = useMemo(
    () => buildOperationalEvidenceDeltaSections(evidenceDelta),
    [evidenceDelta]
  );
  const filteredEvidenceMetrics = useMemo(() => {
    if (!evidenceDelta) return [] as EvidenceDeltaMetricRow[];
    if (activeMetricFocus === "all") return evidenceDelta.metrics;
    return evidenceDelta.metrics.filter(
      (row) => classifyEvidenceMetricFocus(row) === activeMetricFocus
    );
  }, [activeMetricFocus, evidenceDelta]);
  const currentTargetName = current.target_name ?? "Target not recorded";
  const baselineTargetName = baseline?.target_name ?? "Target not recorded";

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        onUploadClick={() => setUploadOpen(true)}
        onCollectEvidenceClick={() => setCollectOpen(true)}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CollectEvidenceModal
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
      />

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          onUploadClick={() => setUploadOpen(true)}
          onCollectEvidenceClick={() => setCollectOpen(true)}
          breadcrumb={
            <>
              <Link href="/" className="hover:text-primary transition-colors">
                Runs
              </Link>
              <span className="text-outline-variant">/</span>
              <Link
                href={`/runs/${current.id}`}
                className="hover:text-primary transition-colors truncate max-w-[140px]"
              >
                {current.filename}
              </Link>
              <span className="text-outline-variant">/</span>
              <span className="text-on-surface font-semibold">Compare</span>
            </>
          }
        />

        <main className="flex-1 overflow-y-auto bg-surface text-on-surface">
          <div className="border-b border-outline-variant/20 bg-surface-container-lowest/80 px-4 lg:px-6 py-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h1 className="font-headline text-lg font-bold tracking-tight">
                    {title}
                  </h1>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-on-surface-variant">
                    Diff-style review of normalized findings plus stable
                    evidence drift. The default baseline is the latest older run
                    for the same logical target, not necessarily the reanalyze
                    parent. Use{" "}
                    <code className="rounded bg-surface-container-high px-1 font-mono text-[10px]">
                      ?against=&lt;runId&gt;
                    </code>{" "}
                    or{" "}
                    <span className="font-semibold text-on-surface">
                      vs parent
                    </span>{" "}
                    for an explicit baseline.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-mono text-on-surface-variant">
                  <span className="rounded border border-outline-variant/30 bg-surface-container-low px-2 py-1">
                    current:{" "}
                    <Link href={`/runs/${current.id}`} className="text-primary">
                      {current.id.slice(0, 8)}…
                    </Link>
                  </span>
                  {baseline ? (
                    <span className="rounded border border-outline-variant/30 bg-surface-container-low px-2 py-1">
                      baseline:{" "}
                      <Link
                        href={`/runs/${baseline.id}`}
                        className="text-primary"
                      >
                        {baseline.id.slice(0, 8)}…
                      </Link>
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Current run
                  </div>
                  <div className="mt-1 text-sm font-semibold text-on-surface">
                    {current.filename}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                    Target:{" "}
                    <span className="font-semibold text-on-surface">
                      {currentTargetName}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-outline-variant">
                    {current.created_at_label}
                  </div>
                </div>
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Baseline
                  </div>
                  <div className="mt-1 text-sm font-semibold text-on-surface">
                    {baseline?.filename ?? "No baseline"}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                    Target:{" "}
                    <span className="font-semibold text-on-surface">
                      {baselineTargetName}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-outline-variant">
                    {baseline?.created_at_label ??
                      "Waiting for older same-target run"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 lg:px-6 py-6 space-y-6 max-w-[1400px]">
            {targetMismatch ? (
              <div
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="alert"
              >
                These runs appear to be from different logical targets
                (identifier or hostname does not match)
                {current.target_name || baseline?.target_name
                  ? ` (${[current.target_name, baseline?.target_name].filter(Boolean).join(" vs ")})`
                  : ""}
                . You can still compare explicit run IDs, but interpret the
                drift carefully. Add{" "}
                <code className="font-mono text-xs bg-black/20 px-1 rounded">
                  ?against=&lt;runId&gt;
                </code>{" "}
                to choose a different baseline.
              </div>
            ) : null}

            {baselineMissing ? (
              <div
                className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant"
                role="status"
              >
                No older run exists for this target yet. Upload fresh evidence
                or reanalyze again later, or open{" "}
                <code className="font-mono text-xs text-on-surface">
                  ?against=&lt;runId&gt;
                </code>{" "}
                to compare against a specific baseline.
              </div>
            ) : null}

            {baseline ? (
              <>
                {evidenceDelta ? (
                  <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-outline-variant/15 bg-surface-container-low/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                          Evidence delta
                        </span>
                        <div className="mt-1 text-xs text-on-surface-variant">
                          Stable evidence and metadata drift for the selected
                          baseline.
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-on-surface-variant">
                        <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2 py-1">
                          Metadata {evidenceDelta.summary.metadata_changed}
                        </span>
                        <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2 py-1">
                          Metrics {evidenceDelta.summary.metric_changes}
                        </span>
                        <span className="rounded-full border border-outline-variant/20 bg-surface-container-low px-2 py-1">
                          Artifact{" "}
                          {evidenceDelta.summary.artifact_changed
                            ? "changed"
                            : "same"}
                        </span>
                      </div>
                      </div>

                    {!evidenceDelta.changed ? (
                      <div className="px-4 py-6 text-sm text-on-surface-variant">
                        Evidence bytes, submission metadata, and stable
                        aggregate metrics were unchanged.
                      </div>
                    ) : (
                      <div className="space-y-4 px-4 py-4">
                        <RunEvidenceSections
                          sections={operationalDeltaSections}
                          heading="Operational delta"
                          description="Stable rollout, pressure, and runtime-health changes pulled out of the evidence delta so you can see operational movement before scanning the raw metric table."
                        />

                        {changedMetadata.length > 0 ? (
                          <div className="space-y-2">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                              Metadata changes
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {changedMetadata.map(([key, status]) => (
                                <span
                                  key={key}
                                  className="inline-flex items-center rounded-full border border-outline-variant/30 bg-surface px-2 py-1 text-[11px] text-on-surface"
                                >
                                  {prettyMetadataLabel(
                                    key as keyof EvidenceDeltaPayload["metadata"],
                                  )}
                                  : {evidenceDeltaStatusLabel(status)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {evidenceDelta.metrics.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                                Stable metric changes
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                                    activeMetricFocus === "all"
                                      ? "border-primary/30 bg-primary/[0.08] text-primary"
                                      : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                                  }`}
                                  onClick={() => setActiveMetricFocus("all")}
                                >
                                  All metrics
                                </button>
                                {EVIDENCE_METRIC_FOCUS_DEFINITIONS.map((definition) => {
                                  const count = evidenceDelta.metrics.filter(
                                    (row) => classifyEvidenceMetricFocus(row) === definition.value
                                  ).length;
                                  return (
                                    <button
                                      key={definition.value}
                                      type="button"
                                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                                        activeMetricFocus === definition.value
                                          ? "border-primary/30 bg-primary/[0.08] text-primary"
                                          : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                                      } ${count === 0 ? "opacity-60" : ""}`}
                                      onClick={() => setActiveMetricFocus(definition.value)}
                                    >
                                      {definition.label} {count}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-outline-variant/15 text-[10px] uppercase tracking-wider text-on-surface-variant">
                                    <th className="px-3 py-2 font-semibold w-[180px]">
                                      Metric
                                    </th>
                                    <th className="px-3 py-2 font-semibold w-[120px]">
                                      Status
                                    </th>
                                    <th className="px-3 py-2 font-semibold w-[160px]">
                                      Before
                                    </th>
                                    <th className="px-3 py-2 font-semibold w-[160px]">
                                      After
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredEvidenceMetrics.map((row) => (
                                    <tr
                                      key={row.key}
                                      className="border-b border-outline-variant/10 align-top hover:bg-surface-container-low/40"
                                    >
                                      <td className="px-3 py-2 font-semibold text-on-surface">
                                        {row.label}
                                      </td>
                                      <td className="px-3 py-2 text-on-surface-variant">
                                        {evidenceDeltaStatusLabel(row.status)}
                                      </td>
                                      <td className="px-3 py-2 font-mono text-on-surface-variant">
                                        {String(row.previous)}
                                      </td>
                                      <td className="px-3 py-2 font-mono text-on-surface-variant">
                                        {String(row.current)}
                                      </td>
                                    </tr>
                                  ))}
                                  {filteredEvidenceMetrics.length === 0 ? (
                                    <tr>
                                      <td
                                        colSpan={4}
                                        className="px-3 py-6 text-center text-on-surface-variant"
                                      >
                                        No metric changes match the current filter.
                                      </td>
                                    </tr>
                                  ) : null}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/15 bg-surface-container-low/60">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Finding changes
                    </span>
                    <span className="text-[10px] text-on-surface-variant">
                      Unchanged: {drift.summary.unchanged}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-outline-variant/15 text-[10px] uppercase tracking-wider text-on-surface-variant">
                          <th className="px-3 py-2 font-semibold w-[120px]">
                            Status
                          </th>
                          <th className="px-3 py-2 font-semibold min-w-[200px]">
                            Title
                          </th>
                          <th className="px-3 py-2 font-semibold w-[140px]">
                            Category
                          </th>
                          <th className="px-3 py-2 font-semibold w-[90px]">
                            Before
                          </th>
                          <th className="px-3 py-2 font-semibold w-[90px]">
                            After
                          </th>
                          <th className="px-3 py-2 font-semibold min-w-[280px]">
                            Evidence delta
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {drift.rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-4 py-8 text-center text-on-surface-variant"
                            >
                              {evidenceDelta?.changed
                                ? `Same finding set; evidence changed in ${evidenceDelta.summary.metadata_changed + evidenceDelta.summary.metric_changes + (evidenceDelta.summary.artifact_changed ? 1 : 0)} place${evidenceDelta.summary.metadata_changed + evidenceDelta.summary.metric_changes + (evidenceDelta.summary.artifact_changed ? 1 : 0) === 1 ? "" : "s"}.`
                                : "No finding changes between these two runs."}
                            </td>
                          </tr>
                        ) : (
                          drift.rows.map((row) => (
                            <tr
                              key={row.match_key}
                              className="border-b border-outline-variant/10 align-top hover:bg-surface-container-low/40"
                            >
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPillClass(row.status)}`}
                                >
                                  {statusLabel(row.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-semibold text-on-surface">
                                {row.title}
                              </td>
                              <td className="px-3 py-2 text-on-surface-variant font-mono text-[11px]">
                                {row.category}
                              </td>
                              <td className="px-3 py-2 font-mono capitalize text-on-surface-variant">
                                {row.previous_severity ?? "—"}
                              </td>
                              <td className="px-3 py-2 font-mono capitalize text-on-surface-variant">
                                {row.current_severity ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="grid gap-1 text-[11px] leading-snug text-on-surface-variant">
                                  {row.status === "new" ? (
                                    <div>
                                      <span className="text-red-700 font-bold mr-1">
                                        +
                                      </span>
                                      {evidenceSnippet(row.evidence_current)}
                                    </div>
                                  ) : null}
                                  {row.status === "resolved" ? (
                                    <div>
                                      <span className="text-emerald-700 font-bold mr-1">
                                        −
                                      </span>
                                      {evidenceSnippet(row.evidence_previous)}
                                    </div>
                                  ) : null}
                                  {(row.status === "severity_up" ||
                                    row.status === "severity_down") && (
                                    <>
                                      <div>
                                        <span className="text-outline-variant mr-1">
                                          was:
                                        </span>
                                        {evidenceSnippet(row.evidence_previous)}
                                      </div>
                                      <div>
                                        <span className="text-outline-variant mr-1">
                                          now:
                                        </span>
                                        {evidenceSnippet(row.evidence_current)}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
