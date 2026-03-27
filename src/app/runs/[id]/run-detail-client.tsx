"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { SeveritySummary } from "@/components/severity-badge";
import { TopActionsPanel } from "@/components/top-actions-panel";
import { FindingsTable } from "@/components/findings-table";
import { FindingsOverview } from "@/components/findings-overview";
import { RunEvidenceSections } from "@/components/run-evidence-sections";
import { SuppressedNoisePanel } from "@/components/suppressed-noise-panel";
import { RunMetadataPanel } from "@/components/run-metadata-panel";
import { EnvironmentBanner } from "@/components/environment-banner";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import type { Severity } from "@/lib/analyzer/schema";
import type { RunDetail } from "@/types/api";
import { compareRunAgainstHref, compareRunHref } from "@/lib/compare/nav";
import { classifyFindingSignal, type FindingSignal } from "@/lib/findings-presentation";
import { buildRunEvidenceSections } from "@/lib/run-evidence-presentation";
import {
  getArtifactFamilyPresentation,
  getArtifactTypeLabel,
} from "@/lib/source-catalog";

interface RunDetailClientProps {
  run: RunDetail;
}

export function RunDetailClient({ run }: RunDetailClientProps) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [reanalyzePending, setReanalyzePending] = useState(false);
  const [activeSignal, setActiveSignal] = useState<FindingSignal | "all">("all");
  const [activeSeverity, setActiveSeverity] = useState<Severity | "all">("all");
  const artifactFamily = getArtifactFamilyPresentation(run.artifact_type);
  const artifactFamilyLabel =
    artifactFamily?.label ?? getArtifactTypeLabel(run.artifact_type);
  const report = run.report;
  const findings = report?.findings ?? [];
  const noise = run.noise ?? report?.noise_or_expected ?? [];
  const topActions = report?.top_actions_now ?? [];
  const evidenceSections = buildRunEvidenceSections(run.artifact_type, findings);
  const filteredFindings = findings.filter((finding) => {
    const matchesSignal =
      activeSignal === "all" || classifyFindingSignal(finding) === activeSignal;
    const matchesSeverity =
      activeSeverity === "all" || finding.severity === activeSeverity;
    return matchesSignal && matchesSeverity;
  });
  const filtersActive = activeSignal !== "all" || activeSeverity !== "all";
  const targetLabel =
    artifactFamily?.value === "container-diagnostics"
      ? "Container workload"
      : artifactFamily?.value === "kubernetes-bundle"
        ? run.target_identifier?.includes(":namespace:")
          ? "Kubernetes namespace"
          : "Kubernetes cluster"
        : "Target host";
  const targetValue =
    run.target_identifier ?? run.environment?.hostname ?? run.filename;
  const targetDetail = run.environment?.os
    ? run.environment.os
    : (artifactFamily?.description ?? null);

  function handleExport() {
    window.open(`/api/runs/${run.id}/report`, "_blank");
  }

  async function handleReanalyze() {
    setReanalyzePending(true);
    try {
      const res = await fetch(`/api/runs/${run.id}/reanalyze`, {
        method: "POST",
      });
      const body = (await res.json()) as { run_id?: string; error?: string };
      if (!res.ok) {
        throw new Error(body.error || `Reanalyze failed (${res.status})`);
      }
      if (!body.run_id) {
        throw new Error("Reanalyze response missing run_id");
      }
      router.push(`/runs/${body.run_id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(msg);
    } finally {
      setReanalyzePending(false);
    }
  }

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
              <span className="text-on-surface font-semibold truncate max-w-[200px]">
                {run.filename}
              </span>
            </>
          }
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Actions Panel */}
          <TopActionsPanel
            actions={topActions}
            onReanalyze={handleReanalyze}
            onExport={handleExport}
            compareHref={compareRunHref(run.id)}
            compareToParentHref={
              run.parent_run
                ? compareRunAgainstHref(run.id, run.parent_run.id)
                : undefined
            }
            reanalyzePending={reanalyzePending}
          />

          <div className="flex-1 overflow-y-auto">
            {/* Run Identity Strip */}
            <div className="border-b border-outline-variant/10 bg-surface-container-low/40">
              <div className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_280px] lg:items-start lg:px-5">
                <div className="space-y-3">
                  <div>
                    <div className="sf-kicker">
                      {targetLabel}
                    </div>
                    <div className="mt-1 text-xl font-bold tracking-tight text-on-surface break-words">
                      {targetValue}
                    </div>
                    {run.environment?.hostname ? (
                      <div className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                        Hostname snapshot:{" "}
                        <span className="font-mono text-on-surface">
                          {run.environment.hostname}
                        </span>
                        {run.environment.os ? (
                          <>
                            {" "}
                            <span className="text-outline-variant">·</span>{" "}
                            {run.environment.os}
                          </>
                        ) : null}
                      </div>
                    ) : targetDetail ? (
                      <div className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                        {targetDetail}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low">
                    <div className="grid grid-cols-2 divide-x divide-outline-variant/10 xl:grid-cols-3">
                      {([
                        { label: "Artifact family", value: artifactFamilyLabel, sub: run.artifact_type, mono: true },
                        { label: "Source", value: run.source_type, sub: run.created_at_label ?? run.created_at },
                        { label: "Artifact source", value: run.source_label ?? "Not recorded", mono: !!run.source_label },
                        { label: "Collector", value: run.collector_type ?? "Direct upload", sub: run.collector_version, mono: !!run.collector_type },
                        { label: "Target ID", value: run.target_identifier ?? "Not recorded", mono: !!run.target_identifier },
                        { label: "Collected at", value: run.collected_at_label ?? "Not recorded" },
                      ] as Array<{ label: string; value: string; sub?: string | null; mono?: boolean }>).map((cell) => (
                        <div key={cell.label} className="border-b border-outline-variant/10 px-3 py-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                            {cell.label}
                          </div>
                          <div className={`mt-0.5 truncate text-sm font-medium text-on-surface ${cell.mono ? "font-mono" : ""}`}>
                            {cell.value}
                          </div>
                          {cell.sub ? (
                            <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                              {cell.sub}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  {run.parent_run ? (
                    <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
                      <p className="text-xs leading-relaxed text-on-surface-variant">
                        Reanalyzed from{" "}
                        <Link
                          href={`/runs/${run.parent_run.id}`}
                          className="font-semibold text-primary hover:underline font-mono"
                        >
                          {run.parent_run.filename}
                        </Link>
                        <span className="text-outline-variant ml-1 font-mono text-[10px]">
                          ({run.parent_run.id.slice(0, 8)}…)
                        </span>
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                        Compare defaults to the latest older run for the same
                        target, which may differ from this parent. Use{" "}
                        <span className="font-semibold text-on-surface">
                          Compare vs parent
                        </span>{" "}
                        to diff against the source run that produced this
                        reanalyze.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <SeveritySummary counts={run.severity_counts} compact />
                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                      Run status
                    </div>
                    <div className="mt-1 text-sm font-semibold text-on-surface">
                      {run.status}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                      {run.analysis_error
                        ? "Analysis completed with an error state."
                        : run.is_incomplete
                          ? "Evidence was incomplete. Findings and summary reflect the bounded artifact."
                          : "Analysis completed successfully for this artifact snapshot."}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="mx-auto max-w-[1440px] px-4 py-5 lg:px-5">
            <div className="space-y-5">
              {/* Summary */}
              {report?.summary && report.summary.length > 0 && (
                <div className="sf-panel border-l-4 border-l-primary p-5">
                  <h3 className="mb-2 font-headline text-base font-bold tracking-tight text-on-surface">
                    Analysis Summary
                  </h3>
                  <ul className="space-y-1.5">
                    {report.summary.map((s, i) => (
                      <li
                        key={i}
                        className="text-xs text-on-surface-variant leading-relaxed pl-4 relative before:absolute before:left-0 before:top-0 before:text-primary before:font-bold before:content-['—']"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {findings.length > 0 ? (
                <FindingsOverview
                  findings={findings}
                  filteredCount={filteredFindings.length}
                  activeSignal={activeSignal}
                  activeSeverity={activeSeverity}
                  onSignalChange={setActiveSignal}
                  onSeverityChange={setActiveSeverity}
                />
              ) : null}

              <RunEvidenceSections sections={evidenceSections} />

              {/* Findings Table */}
              <FindingsTable
                findings={filteredFindings}
                emptyMessage={
                  filtersActive
                    ? "No findings match the current overview filters."
                    : "No findings for this run."
                }
              />

              {/* Bottom grid: Suppressed Noise + Run Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SuppressedNoisePanel items={noise} />
                <RunMetadataPanel run={run} />
              </div>

              {/* Environment */}
              {run.environment && <EnvironmentBanner env={run.environment} />}
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
