"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { CollectionPulse, type CollectionPulseData } from "@/components/collection-pulse";
import {
  DashboardOperationalHighlights,
  type DashboardOperationalHighlight,
} from "@/components/dashboard-operational-highlights";
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
  operationalHighlights: DashboardOperationalHighlight[];
}

const sevColors: Record<string, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-outline-variant",
};

function runSeverityTotal(
  counts: Record<string, number>,
  severities: Array<"critical" | "high" | "medium" | "low">
) {
  return severities.reduce((total, severity) => total + (counts[severity] ?? 0), 0);
}

function runAttentionScore(run: RunSummary) {
  return (
    (run.severity_counts.critical ?? 0) * 1000 +
    (run.severity_counts.high ?? 0) * 100 +
    (run.severity_counts.medium ?? 0) * 10 +
    (run.severity_counts.low ?? 0)
  );
}

export function DashboardClient({
  runs,
  collectionSources,
  totalRuns,
  criticalFindings,
  environmentsAnalyzed,
  suppressedNoise,
  severityDistribution,
  collectionPulse,
  operationalHighlights,
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
  const latestRun = runs[0] ?? null;
  const attentionRuns = [...runs]
    .filter((run) => runAttentionScore(run) > 0)
    .sort((a, b) => runAttentionScore(b) - runAttentionScore(a))
    .slice(0, 4);

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
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {latestRun ? (
                  <>
                    <Link
                      href={`/runs/${latestRun.id}`}
                      className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-1.5 font-medium text-on-surface hover:bg-surface-container"
                    >
                      Open latest run
                    </Link>
                    <Link
                      href={`/runs/${latestRun.id}/compare`}
                      className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-1.5 font-medium text-on-surface hover:bg-surface-container"
                    >
                      Compare latest
                    </Link>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setCollectOpen(true)}
                  className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-1.5 font-medium text-on-surface hover:bg-surface-container"
                >
                  How to collect
                </button>
              </div>
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

          {/* Main Grid: Table + Right Rail */}
          <div className="grid grid-cols-12 gap-6">
            {/* Runs Table */}
            <div className="col-span-12 xl:col-span-8">
              <RunTable runs={runs} />
            </div>

            {/* Right Rail */}
            <div className="col-span-12 space-y-4 xl:col-span-4">
              <CollectionPulse pulse={collectionPulse} />
              <DashboardOperationalHighlights highlights={operationalHighlights} />

              <div className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-headline text-sm font-bold text-on-surface">
                      Posture at a glance
                    </h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                      Use this rail to spot where attention should go before drilling into the run table.
                    </p>
                  </div>
                  <div className="rounded-md border border-outline-variant/15 bg-surface-container-low px-3 py-2 text-right">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-outline-variant">
                      Total findings
                    </div>
                    <div className="mt-0.5 text-lg font-bold leading-none text-on-surface">
                      {totalFindings}
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {(["critical", "high", "medium", "low"] as const).map((sev) => {
                    const count = severityDistribution[sev] ?? 0;
                    const maxCount = Math.max(...Object.values(severityDistribution), 1);
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
                  })}
                </div>

                <div className="mt-6 border-t border-surface-container pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <h5 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Attention queue
                    </h5>
                    {latestRun ? (
                      <Link
                        href={`/runs/${latestRun.id}`}
                        className="text-[10px] font-semibold text-primary hover:underline"
                      >
                        Latest run
                      </Link>
                    ) : null}
                  </div>

                  {attentionRuns.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {attentionRuns.map((run) => {
                        const criticalHigh = runSeverityTotal(run.severity_counts, ["critical", "high"]);
                        const mediumLow = runSeverityTotal(run.severity_counts, ["medium", "low"]);
                        return (
                          <Link
                            key={run.id}
                            href={`/runs/${run.id}`}
                            className="block rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 py-3 transition-colors hover:bg-surface-container"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[12px] font-semibold text-on-surface">
                                  {run.filename}
                                </div>
                                <div className="mt-1 line-clamp-2 break-all text-[10px] text-on-surface-variant">
                                  {run.target_identifier ?? run.hostname ?? "Target not recorded"}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[10px] font-bold text-on-surface-variant">
                                  {run.created_at_label ?? run.created_at}
                                </div>
                                <div className="mt-1 text-[10px] font-semibold text-on-surface">
                                  {criticalHigh > 0 ? `${criticalHigh} critical/high` : `${mediumLow} medium/low`}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center gap-3">
                              <span className="flex items-center gap-1 text-[10px] font-medium text-on-surface-variant">
                                <span className="h-2 w-2 rounded-full bg-severity-critical" />
                                {run.severity_counts.critical ?? 0}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] font-medium text-on-surface-variant">
                                <span className="h-2 w-2 rounded-full bg-severity-high" />
                                {run.severity_counts.high ?? 0}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] font-medium text-on-surface-variant">
                                <span className="h-2 w-2 rounded-full bg-severity-medium" />
                                {run.severity_counts.medium ?? 0}
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-on-surface-variant">
                      No elevated runs yet. Fresh uploads will appear here when they carry findings worth attention.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
