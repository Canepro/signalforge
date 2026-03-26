"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { CollectionPulse, type CollectionPulseData } from "@/components/collection-pulse";
import { RunTable } from "@/components/run-table";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import {
  RequestCollectionModal,
  type DashboardCollectionSource,
} from "@/components/request-collection-modal";
import { requestCollectionFromDashboardAction } from "@/app/sources/actions";
import type { RunSummary } from "@/types/api";

interface DashboardClientProps {
  runs: RunSummary[];
  collectionSources: DashboardCollectionSource[];
  totalRuns: number;
  criticalFindings: number;
  environmentsAnalyzed: number;
  suppressedNoise: number;
  severityDistribution: Record<string, number>;
  collectionPulse: CollectionPulseData;
}

const sevColors: Record<string, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-outline-variant",
};

export function DashboardClient({
  runs,
  collectionSources,
  totalRuns,
  criticalFindings,
  environmentsAnalyzed,
  suppressedNoise,
  severityDistribution,
  collectionPulse,
}: DashboardClientProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [isQuickRequestPending, startQuickRequestTransition] = useTransition();
  const [quickRequestFeedback, setQuickRequestFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const hasLiveCollectionSource = collectionSources.length > 0;
  const singleSource = collectionSources.length === 1 ? collectionSources[0]! : null;
  const canQuickRequest =
    singleSource !== null &&
    (singleSource.expected_artifact_type === "linux-audit-log" ||
      singleSource.default_collection_scope !== null);
  const quickSource = canQuickRequest ? singleSource : null;

  const totalFindings = Object.values(severityDistribution).reduce(
    (a, b) => a + b,
    0
  );

  useEffect(() => {
    if (!quickRequestFeedback || quickRequestFeedback.tone !== "success") return;
    const timer = window.setTimeout(() => setQuickRequestFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [quickRequestFeedback]);

  function Spinner({ className = "h-4 w-4" }: { className?: string }) {
    return (
      <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" className="stroke-current/20" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 00-9-9"
          className="stroke-current"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  function handlePrimaryCollectionAction() {
    if (!hasLiveCollectionSource) {
      setCollectOpen(true);
      return;
    }

    if (!canQuickRequest || !quickSource) {
      setRequestOpen(true);
      return;
    }

    setQuickRequestFeedback(null);
    startQuickRequestTransition(() => {
      const formData = new FormData();
      formData.set("source_id", quickSource.id);
      formData.set("request_reason", "");
      void requestCollectionFromDashboardAction(formData).then((result) => {
        if (result.ok) {
          setQuickRequestFeedback({
            tone: "success",
            message: `Queued for ${result.source_name}. A running agent should claim it shortly.`,
          });
          return;
        }

        setQuickRequestFeedback({
          tone: "error",
          message:
            result.error === "admin_required" ? "Admin sign-in required to queue jobs."
            : result.error === "not_ready" ? "Source is no longer live."
            : result.error === "disabled" ? "Source is disabled."
            : result.error === "not_found" ? "Source no longer exists."
            : "Choose a source before requesting collection.",
        });
      });
    });
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        onUploadClick={() => setUploadOpen(true)}
        onCollectEvidenceClick={() => setCollectOpen(true)}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CollectEvidenceModal open={collectOpen} onClose={() => setCollectOpen(false)} />
      <RequestCollectionModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        sources={collectionSources}
      />

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          onUploadClick={() => setUploadOpen(true)}
          onCollectEvidenceClick={() => setCollectOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
          {/* Action Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h2 className="font-headline text-2xl font-bold text-on-surface tracking-tight">
                Diagnostics Overview
              </h2>
              <p className="text-sm text-on-surface-variant">
                Review uploaded evidence, queue fresh collection, and track drift across hosts, containers, and Kubernetes targets.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <button
                type="button"
                onClick={handlePrimaryCollectionAction}
                disabled={isQuickRequestPending}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-b from-primary to-primary-dim px-4 py-2 text-sm font-semibold text-on-primary shadow-md transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                title={
                  !hasLiveCollectionSource ? "Set up external collection for SignalForge"
                  : canQuickRequest ? "Queue a collection job for the live source"
                  : "Choose a live source and queue a collection job"
                }
              >
                {isQuickRequestPending ? (
                  <Spinner />
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                )}
                {!hasLiveCollectionSource ? "Set up collection"
                : canQuickRequest ? (isQuickRequestPending ? "Requesting…" : "Request collection")
                : "Request collection"}
              </button>
              {hasLiveCollectionSource ? (
                <p className="text-[11px] leading-relaxed text-on-surface-variant">
                  {canQuickRequest ?
                    `${quickSource!.display_name} is live. One click queues work for its next agent poll.`
                  : singleSource ?
                    `${singleSource.display_name} is live. Open the request dialog to confirm or override its collection scope.`
                  : `${collectionSources.length} live sources are ready. Choose one to queue work for its next agent poll.`}
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-on-surface-variant">
                  No live sources yet. Complete setup once, then this becomes an operational action.
                </p>
              )}
              {quickRequestFeedback ? (
                <p
                  className={`text-[11px] font-medium ${
                    quickRequestFeedback.tone === "success" ? "text-emerald-700 dark:text-emerald-300"
                    : "text-amber-800 dark:text-amber-200"
                  }`}
                >
                  {quickRequestFeedback.message}
                </p>
              ) : null}
            </div>
          </div>

          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Runs"
              value={totalRuns}
              accentColor="bg-primary"
            />
            <KpiCard
              label="New Critical Findings"
              value={criticalFindings}
              accentColor="bg-severity-critical"
            />
            <KpiCard
              label="Targets analyzed"
              value={environmentsAnalyzed}
              accentColor="bg-secondary"
            />
            <KpiCard
              label="Suppressed Noise"
              value={suppressedNoise > 999 ? `${(suppressedNoise / 1000).toFixed(1)}k` : suppressedNoise}
              subtitle="Filtered expected"
              accentColor="bg-outline"
            />
          </div>

          {/* Main Grid: Table (9 cols) + Right Rail (3 cols) */}
          <div className="grid grid-cols-12 gap-6">
            {/* Runs Table */}
            <div className="col-span-12 lg:col-span-9">
              <RunTable runs={runs} />
            </div>

            {/* Right Rail */}
            <div className="col-span-12 lg:col-span-3 space-y-4">
              {/* Action Buttons */}
              <div className="space-y-2">
                {runs.length > 0 ? (
                  <Link
                    href={`/runs/${runs[0]!.id}`}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg transition-all"
                    title="Opens your most recent run — use Reanalyze on the run page"
                  >
                    <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <div className="text-left">
                      <p className="text-xs font-bold leading-tight">
                        Reanalyze Artifact
                      </p>
                      <p className="text-[10px] text-on-surface-variant">
                        Open latest run, then reanalyze there
                      </p>
                    </div>
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full flex items-center gap-3 px-4 py-3 bg-surface-container-high text-on-surface rounded-lg transition-all opacity-60 cursor-not-allowed"
                  >
                    <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <div className="text-left">
                      <p className="text-xs font-bold leading-tight">
                        Reanalyze Artifact
                      </p>
                      <p className="text-[10px] text-on-surface-variant">
                        Upload a run first
                      </p>
                    </div>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCollectOpen(true)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-surface-container-high px-4 py-3 text-on-surface transition-all hover:bg-surface-container-highest"
                >
                  <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  <div className="text-left">
                    <p className="text-xs font-bold leading-tight">
                      How to collect
                    </p>
                    <p className="text-[10px] text-on-surface-variant">
                      Copy agent, CLI, and collector commands
                    </p>
                  </div>
                </button>
                {runs.length > 0 ? (
                  <Link
                    href={`/runs/${runs[0]!.id}/compare`}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg transition-all"
                    title="Drift view for the latest run (auto baseline = prior same-target run if any)"
                  >
                    <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <div className="text-left">
                      <p className="text-xs font-bold leading-tight">
                        Compare to Previous
                      </p>
                      <p className="text-[10px] text-on-surface-variant">
                        Latest run vs prior (same target)
                      </p>
                    </div>
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full flex items-center gap-3 px-4 py-3 bg-surface-container-high text-on-surface rounded-lg transition-all opacity-60 cursor-not-allowed"
                  >
                    <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <div className="text-left">
                      <p className="text-xs font-bold leading-tight">
                        Compare to Previous
                      </p>
                      <p className="text-[10px] text-on-surface-variant">
                        Upload a run first
                      </p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Lower Supporting Section */}
          <div className="grid grid-cols-1 gap-6 pb-6 md:grid-cols-2 lg:grid-cols-12">
            {/* Severity Distribution */}
            <div className="rounded-lg bg-surface-container-lowest p-5 shadow-sm lg:col-span-3">
              <h4 className="font-headline font-bold text-on-surface mb-5 text-sm">
                Severity Distribution
              </h4>
              <div className="space-y-3">
                {(["critical", "high", "medium", "low"] as const).map(
                  (sev) => {
                    const count = severityDistribution[sev] ?? 0;
                    const maxCount = Math.max(
                      ...Object.values(severityDistribution),
                      1
                    );
                    const pct = Math.round((count / maxCount) * 100);
                    return (
                      <div key={sev} className="space-y-1">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                          <span>{sev}</span>
                          <span>{count}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-surface-container-low">
                          <div
                            className={`h-full rounded-full ${sevColors[sev]} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            <div className="md:col-span-2 lg:col-span-6">
              <CollectionPulse pulse={collectionPulse} />
            </div>

            {/* Diagnostics Feed */}
            <div className="rounded-lg border-l-4 border-primary bg-surface-container-lowest p-5 shadow-sm md:col-span-2 lg:col-span-3">
              <h4 className="font-headline font-bold text-on-surface mb-4 text-sm">
                Diagnostics Feed
              </h4>
              {runs.length > 0 ? (
                <div className="space-y-3">
                  {runs.slice(0, 5).map((run) => {
                    const totalSev = Object.values(run.severity_counts).reduce(
                      (a, b) => a + b,
                      0
                    );
                    return (
                      <div key={run.id} className="flex gap-3">
                        <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded bg-surface-container-low">
                          <svg className="h-3 w-3 text-outline-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className="text-[11px] min-w-0">
                          <p className="font-bold text-on-surface truncate">
                            {run.filename}
                          </p>
                          <p className="text-on-surface-variant">
                            {totalSev} finding{totalSev !== 1 ? "s" : ""}{" "}
                            recorded
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-outline-variant">
                  No recent activity.
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
