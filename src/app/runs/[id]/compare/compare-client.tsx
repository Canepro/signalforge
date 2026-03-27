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
import type { BaselineSelection } from "@/lib/compare/build-compare";

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
  baselineSelection: BaselineSelection;
  baselineCandidates: CompareRunHeader[];
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
      return "border-red-200 bg-red-50 text-red-800";
    case "resolved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "severity_up":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "severity_down":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-outline-variant/20 bg-surface-container-low text-on-surface-variant";
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

function baselineSelectionLabel(selection: BaselineSelection): string {
  switch (selection) {
    case "explicit":
      return "Explicit baseline";
    case "implicit_same_target":
      return "Automatic same-target baseline";
    default:
      return "No baseline yet";
  }
}

function baselineSelectionDescription(selection: BaselineSelection): string {
  switch (selection) {
    case "explicit":
      return "This compare view is pinned to a specific older run instead of the automatic same-target default.";
    case "implicit_same_target":
      return "SignalForge selected the latest older run for the same logical target. You can switch to another older run below.";
    default:
      return "No older same-target run is available yet. Compare will become more useful after another upload or reanalyze for this target.";
  }
}

export function CompareClient({
  current,
  baseline,
  drift,
  evidenceDelta,
  targetMismatch,
  baselineMissing,
  baselineSelection,
  baselineCandidates,
}: CompareClientProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [activeMetricFocus, setActiveMetricFocus] = useState<EvidenceMetricFocus>("all");

  const title = useMemo(
    () =>
      baseline
        ? `Compare drift: ${baseline.filename} → ${current.filename}`
        : "Compare drift",
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
  const evidenceChangeCount = evidenceDelta
    ? evidenceDelta.summary.metadata_changed +
      evidenceDelta.summary.metric_changes +
      (evidenceDelta.summary.artifact_changed ? 1 : 0)
    : 0;

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

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
          <div className="border-b border-outline-variant/10 bg-surface-container-low/40">
            <div className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 lg:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="sf-kicker">Drift review</p>
                  <h1 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
                    {title}
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
                    Compare normalized findings and stable evidence drift without relying on hidden query-string knowledge.
                    Automatic baseline selection uses the latest older run for the same logical target when one exists.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/runs/${current.id}`} className="sf-btn-secondary">
                    Open current run
                  </Link>
                  {baseline ? (
                    <Link href={`/runs/${baseline.id}`} className="sf-btn-secondary">
                      Open baseline
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="sf-panel px-4 py-4">
                    <p className="sf-kicker">Current run</p>
                    <div className="mt-2 text-base font-semibold text-on-surface">
                      {current.filename}
                    </div>
                    <div className="mt-1 text-sm text-on-surface-variant">
                      Target: <span className="font-semibold text-on-surface">{currentTargetName}</span>
                    </div>
                    <div className="mt-2 text-xs font-mono text-outline-variant">
                      {current.created_at_label}
                    </div>
                  </div>
                  <div className="sf-panel px-4 py-4">
                    <p className="sf-kicker">Baseline</p>
                    <div className="mt-2 text-base font-semibold text-on-surface">
                      {baseline?.filename ?? "No baseline selected"}
                    </div>
                    <div className="mt-1 text-sm text-on-surface-variant">
                      Target: <span className="font-semibold text-on-surface">{baselineTargetName}</span>
                    </div>
                    <div className="mt-2 text-xs font-mono text-outline-variant">
                      {baseline?.created_at_label ?? "Waiting for older same-target run"}
                    </div>
                  </div>
                </div>

                <div className="sf-panel-muted px-4 py-4">
                  <p className="sf-kicker">Baseline selection</p>
                  <div className="mt-2 text-base font-semibold text-on-surface">
                    {baselineSelectionLabel(baselineSelection)}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                    {baselineSelectionDescription(baselineSelection)}
                  </p>

                  {baselineCandidates.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                        Choose another older run
                      </div>
                      <div className="space-y-2">
                        {baselineCandidates.map((candidate) => {
                          const selected = baseline?.id === candidate.id;
                          return (
                            <Link
                              key={candidate.id}
                              href={`/runs/${current.id}/compare?against=${candidate.id}`}
                              className={`block rounded-xl border px-3 py-3 transition-[background-color,border-color,box-shadow] duration-150 ${
                                selected
                                  ? "border-primary/30 bg-primary/[0.07] shadow-sm"
                                  : "border-outline-variant/15 bg-surface-container-lowest hover:border-outline-variant/25 hover:bg-surface-container hover:shadow-sm"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-on-surface">
                                    {candidate.filename}
                                  </div>
                                  <div className="mt-1 line-clamp-2 break-all text-xs text-on-surface-variant">
                                    {candidate.target_name ?? "Target not recorded"}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  {selected ? (
                                    <div className="text-[11px] font-semibold text-primary">
                                      Selected
                                    </div>
                                  ) : null}
                                  <div className="mt-1 text-[11px] text-on-surface-variant">
                                    {candidate.created_at_label}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs leading-relaxed text-on-surface-variant">
                      No other older same-target runs are currently available. Deep-link compares still support{" "}
                      <code className="sf-inline-code">?against=&lt;runId&gt;</code> when you need to pin a specific run.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 lg:px-6">
            {targetMismatch ? (
              <div
                className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="alert"
              >
                These runs appear to represent different logical targets
                {current.target_name || baseline?.target_name
                  ? ` (${[current.target_name, baseline?.target_name].filter(Boolean).join(" vs ")})`
                  : ""}
                . This compare is still allowed, but treat the drift as an explicit cross-target review rather than a same-target timeline.
              </div>
            ) : null}

            {baselineMissing ? (
              <div
                className="sf-panel px-4 py-4"
                role="status"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="sf-kicker">Baseline missing</p>
                    <div className="mt-1 text-base font-semibold text-on-surface">
                      No older run exists for this target yet
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                      Upload fresh evidence or reanalyze this target again later. Compare becomes more valuable once there is another same-target snapshot to diff against.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/runs/${current.id}`} className="sf-btn-secondary">
                      Open current run
                    </Link>
                    <button type="button" onClick={() => setUploadOpen(true)} className="sf-btn-primary">
                      Upload next snapshot
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {baseline ? (
              <>
                {evidenceDelta ? (
                  <div className="sf-panel overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-outline-variant/15 bg-surface-container-low/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="sf-kicker">Evidence delta</div>
                        <div className="mt-1 text-sm text-on-surface-variant">
                          Stable evidence and metadata drift for the selected baseline.
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                        <span className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5">
                          Metadata {evidenceDelta.summary.metadata_changed}
                        </span>
                        <span className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5">
                          Metrics {evidenceDelta.summary.metric_changes}
                        </span>
                        <span className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5">
                          Artifact {evidenceDelta.summary.artifact_changed ? "changed" : "same"}
                        </span>
                      </div>
                    </div>

                    {!evidenceDelta.changed ? (
                      <div className="px-5 py-6 text-sm text-on-surface-variant">
                        Evidence bytes, submission metadata, and stable aggregate metrics were unchanged.
                      </div>
                    ) : (
                      <div className="space-y-5 px-5 py-5">
                        <RunEvidenceSections
                          sections={operationalDeltaSections}
                          heading="Operational delta"
                          description="Stable rollout, pressure, runtime-health, and namespace-guardrail changes are pulled out first so you can see meaningful movement before scanning the raw metric table."
                        />

                        {changedMetadata.length > 0 ? (
                          <div className="space-y-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                              Metadata changes
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                              {changedMetadata.map(([key, status]) => (
                                <div
                                  key={key}
                                  className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-3"
                                >
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                                    {prettyMetadataLabel(
                                      key as keyof EvidenceDeltaPayload["metadata"],
                                    )}
                                  </div>
                                  <div className="mt-1 text-sm font-semibold text-on-surface">
                                    {evidenceDeltaStatusLabel(status)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {evidenceDelta.metrics.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                                Stable metric changes
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
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
                                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
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
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b border-outline-variant/15 text-[11px] uppercase tracking-[0.14em] text-on-surface-variant">
                                    <th className="w-[180px] px-3 py-2 font-semibold">
                                      Metric
                                    </th>
                                    <th className="w-[120px] px-3 py-2 font-semibold">
                                      Status
                                    </th>
                                    <th className="w-[160px] px-3 py-2 font-semibold">
                                      Before
                                    </th>
                                    <th className="w-[160px] px-3 py-2 font-semibold">
                                      After
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredEvidenceMetrics.map((row) => (
                                    <tr
                                      key={row.key}
                                      className="sf-table-row border-b border-outline-variant/10 align-top"
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

                <div className="sf-panel overflow-hidden">
                  <div className="flex flex-col gap-2 border-b border-outline-variant/15 bg-surface-container-low/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="sf-kicker">Finding changes</p>
                      <div className="mt-1 text-sm text-on-surface-variant">
                        Drift in normalized findings between the current run and selected baseline.
                      </div>
                    </div>
                    <span className="text-xs text-on-surface-variant">
                      Unchanged: {drift.summary.unchanged}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-outline-variant/15 text-[11px] uppercase tracking-[0.14em] text-on-surface-variant">
                          <th className="w-[130px] px-3 py-2 font-semibold">
                            Status
                          </th>
                          <th className="min-w-[220px] px-3 py-2 font-semibold">
                            Title
                          </th>
                          <th className="w-[150px] px-3 py-2 font-semibold">
                            Category
                          </th>
                          <th className="w-[100px] px-3 py-2 font-semibold">
                            Before
                          </th>
                          <th className="w-[100px] px-3 py-2 font-semibold">
                            After
                          </th>
                          <th className="min-w-[300px] px-3 py-2 font-semibold">
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
                                ? `Same finding set; evidence changed in ${evidenceChangeCount} place${evidenceChangeCount === 1 ? "" : "s"}.`
                                : "No finding changes between these two runs."}
                            </td>
                          </tr>
                        ) : (
                          drift.rows.map((row) => (
                            <tr
                              key={row.match_key}
                              className="sf-table-row border-b border-outline-variant/10 align-top"
                            >
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusPillClass(row.status)}`}
                                >
                                  {statusLabel(row.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-semibold text-on-surface">
                                {row.title}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-on-surface-variant">
                                {row.category}
                              </td>
                              <td className="px-3 py-2 font-mono capitalize text-on-surface-variant">
                                {row.previous_severity ?? "—"}
                              </td>
                              <td className="px-3 py-2 font-mono capitalize text-on-surface-variant">
                                {row.current_severity ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="grid gap-1 text-xs leading-snug text-on-surface-variant">
                                  {row.status === "new" ? (
                                    <div>
                                      <span className="mr-1 font-bold text-red-700">
                                        +
                                      </span>
                                      {evidenceSnippet(row.evidence_current)}
                                    </div>
                                  ) : null}
                                  {row.status === "resolved" ? (
                                    <div>
                                      <span className="mr-1 font-bold text-emerald-700">
                                        −
                                      </span>
                                      {evidenceSnippet(row.evidence_previous)}
                                    </div>
                                  ) : null}
                                  {(row.status === "severity_up" ||
                                    row.status === "severity_down") && (
                                    <>
                                      <div>
                                        <span className="mr-1 text-outline-variant">
                                          was:
                                        </span>
                                        {evidenceSnippet(row.evidence_previous)}
                                      </div>
                                      <div>
                                        <span className="mr-1 text-outline-variant">
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
