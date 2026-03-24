"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { SeveritySummary } from "@/components/severity-badge";
import { TopActionsPanel } from "@/components/top-actions-panel";
import { FindingsTable } from "@/components/findings-table";
import { SuppressedNoisePanel } from "@/components/suppressed-noise-panel";
import { RunMetadataPanel } from "@/components/run-metadata-panel";
import { EnvironmentBanner } from "@/components/environment-banner";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import type { RunDetail } from "@/types/api";
import { compareRunAgainstHref, compareRunHref } from "@/lib/compare/nav";

interface RunDetailClientProps {
  run: RunDetail;
}

export function RunDetailClient({ run }: RunDetailClientProps) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [reanalyzePending, setReanalyzePending] = useState(false);
  const report = run.report;
  const findings = report?.findings ?? [];
  const noise = run.noise ?? report?.noise_or_expected ?? [];
  const topActions = report?.top_actions_now ?? [];

  function handleExport() {
    window.open(`/api/runs/${run.id}/report`, "_blank");
  }

  async function handleReanalyze() {
    setReanalyzePending(true);
    try {
      const res = await fetch(`/api/runs/${run.id}/reanalyze`, { method: "POST" });
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
      <CollectEvidenceModal open={collectOpen} onClose={() => setCollectOpen(false)} />

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          breadcrumb={
            <>
              <Link
                href="/"
                className="hover:text-primary transition-colors"
              >
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
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start border-b border-surface-container px-4 lg:px-6 py-4">
              <div className="flex items-center gap-6 flex-wrap">
                {run.environment && (
                  <div>
                    <div className="text-[10px] font-bold text-outline-variant uppercase tracking-widest">
                      Target Host
                    </div>
                    <div className="text-base font-bold text-on-surface">
                      {run.environment.hostname}
                      <span className="text-xs font-normal text-on-surface-variant ml-2">
                        {run.environment.os}
                      </span>
                    </div>
                  </div>
                )}
                <div className="h-8 w-px bg-surface-container hidden lg:block" />
                <div>
                  <div className="text-[10px] font-bold text-outline-variant uppercase tracking-widest">
                    Artifact
                  </div>
                  <div className="text-xs font-mono text-primary font-semibold">
                    {run.filename}
                    <span className="text-outline-variant font-normal ml-2">
                      {run.created_at_label ?? run.created_at}
                    </span>
                  </div>
                  {run.parent_run ? (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[11px] text-on-surface-variant">
                        Reanalyzed from{" "}
                        <Link
                          href={`/runs/${run.parent_run.id}`}
                          className="text-primary font-semibold hover:underline font-mono"
                        >
                          {run.parent_run.filename}
                        </Link>
                        <span className="text-outline-variant ml-1 font-mono text-[10px]">
                          ({run.parent_run.id.slice(0, 8)}…)
                        </span>
                      </p>
                      <p className="text-[10px] text-on-surface-variant max-w-xl leading-snug">
                        Default compare uses the latest older run for the same target, which may differ
                        from this parent. Use <span className="font-semibold text-on-surface">vs parent</span>{" "}
                        in the bar above to diff against this source run.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              <SeveritySummary counts={run.severity_counts} compact />
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

              {/* Findings Table */}
              <FindingsTable findings={findings} />

              {/* Bottom grid: Suppressed Noise + Run Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SuppressedNoisePanel items={noise} />
                <RunMetadataPanel run={run} />
              </div>

              {/* Environment */}
              {run.environment && (
                <EnvironmentBanner env={run.environment} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
