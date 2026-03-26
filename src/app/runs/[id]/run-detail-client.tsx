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
import { SuppressedNoisePanel } from "@/components/suppressed-noise-panel";
import { RunMetadataPanel } from "@/components/run-metadata-panel";
import { EnvironmentBanner } from "@/components/environment-banner";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import type { Severity } from "@/lib/analyzer/schema";
import type { RunDetail } from "@/types/api";
import { compareRunAgainstHref, compareRunHref } from "@/lib/compare/nav";
import { classifyFindingSignal, type FindingSignal } from "@/lib/findings-presentation";
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
            <div className="border-b border-surface-container px-4 lg:px-6 py-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:items-start">
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-outline-variant">
                      {targetLabel}
                    </div>
                    <div className="mt-1 text-base font-bold text-on-surface break-words">
                      {targetValue}
                    </div>
                    {run.environment?.hostname ? (
                      <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
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
                      <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                        {targetDetail}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 font-semibold text-on-surface">
                      {artifactFamilyLabel}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 font-mono text-on-surface-variant">
                      {run.artifact_type}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 text-on-surface-variant">
                      source: {run.source_type}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-outline-variant/20 bg-surface-container-low px-2.5 py-1 text-on-surface-variant">
                      {run.created_at_label ?? run.created_at}
                    </span>
                  </div>

                  <div className="grid gap-2 text-[11px] text-on-surface-variant sm:grid-cols-2">
                    <div className="rounded-md border border-outline-variant/15 bg-surface-container-low px-3 py-2">
                      <div className="font-bold uppercase tracking-widest text-outline-variant">
                        Artifact source
                      </div>
                      <div className="mt-1 break-words">
                        {run.source_label ? (
                          <span className="font-mono text-on-surface">
                            {run.source_label}
                          </span>
                        ) : (
                          "Not recorded"
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border border-outline-variant/15 bg-surface-container-low px-3 py-2">
                      <div className="font-bold uppercase tracking-widest text-outline-variant">
                        Collector
                      </div>
                      <div className="mt-1 break-words">
                        {run.collector_type ? (
                          <span className="font-mono text-on-surface">
                            {run.collector_type}
                          </span>
                        ) : (
                          "Direct upload"
                        )}
                      </div>
                    </div>
                  </div>

                  {run.parent_run ? (
                    <div className="space-y-1 rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 py-2">
                      <p className="text-[11px] leading-relaxed text-on-surface-variant">
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
                      <p className="text-[10px] leading-snug text-on-surface-variant">
                        Compare defaults to the latest older run for the same
                        target, which may differ from this parent. Use{" "}
                        <span className="font-semibold text-on-surface">
                          vs parent
                        </span>{" "}
                        to diff against the source run that produced this
                        reanalyze.
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="lg:pt-1">
                  <SeveritySummary counts={run.severity_counts} compact />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-4 lg:px-6 py-6 space-y-6">
              {/* Summary */}
              {report?.summary && report.summary.length > 0 && (
                <div className="rounded-lg bg-surface-container-lowest p-5 shadow-sm border-l-4 border-primary">
                  <h3 className="font-headline text-sm font-bold text-on-surface mb-2">
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
  );
}
