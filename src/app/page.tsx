import { DashboardClient } from "./dashboard-client";
import { LivePageRefresh } from "@/components/live-page-refresh";
import type { ArtifactType } from "@/lib/source-catalog";
import type { RunSummary } from "@/types/api";
import { getStorage } from "@/lib/storage";
import type { DashboardCollectionSource } from "@/components/request-collection-modal";

export const dynamic = "force-dynamic";

interface DashboardStats {
  totalRuns: number;
  criticalFindings: number;
  environmentsAnalyzed: number;
  suppressedNoise: number;
  severityDistribution: Record<string, number>;
  environmentMix: Record<string, number>;
}

function formatRelativeTime(iso: string, nowMs: number): string {
  const createdMs = new Date(iso).getTime();
  const diffMs = nowMs - createdMs;
  const diffH = Math.floor(diffMs / 3600000);

  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${diffH}h ago`;

  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function computeStats(runs: RunSummary[]): DashboardStats {
  let criticalFindings = 0;
  let suppressedNoise = 0;
  const logicalTargets = new Set<string>();
  const distribution: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const envMix: Record<string, number> = {};

  for (const run of runs) {
    const counts = run.severity_counts;
    criticalFindings += counts.critical ?? 0;
    distribution.critical += counts.critical ?? 0;
    distribution.high += counts.high ?? 0;
    distribution.medium += counts.medium ?? 0;
    distribution.low += counts.low ?? 0;

    const logicalTarget = run.target_identifier || run.hostname || null;
    if (logicalTarget) logicalTargets.add(logicalTarget);

    for (const tag of run.env_tags) {
      envMix[tag] = (envMix[tag] ?? 0) + 1;
    }
  }

  return {
    totalRuns: runs.length,
    criticalFindings,
    environmentsAnalyzed: logicalTargets.size,
    suppressedNoise,
    severityDistribution: distribution,
    environmentMix: envMix,
  };
}

export default async function DashboardPage() {
  const storage = await getStorage();
  const nowMs = Date.now();
  const runs = (await storage.runs.listSummaries()).map((run) => ({
    ...run,
    created_at_label: formatRelativeTime(run.created_at, nowMs),
  }));
  const stats = computeStats(runs);
  stats.suppressedNoise = await storage.runs.countSuppressedNoise();
  const sources = await storage.sources.list({ enabled: true });
  const collectionSources = (
    await Promise.all(
      sources.map(async (source) => {
        const registration = await storage.agents.getRegistrationBySourceId(source.id);
        if (!registration || source.health_status !== "online") return null;
        return {
          id: source.id,
          display_name: source.display_name,
          target_identifier: source.target_identifier,
          expected_artifact_type: source.expected_artifact_type as ArtifactType,
          last_seen_at: source.last_seen_at,
          default_collection_scope: source.default_collection_scope,
        } satisfies DashboardCollectionSource;
      })
    )
  )
    .filter((source): source is DashboardCollectionSource => source !== null)
    .sort((a, b) => {
      const aMs = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const bMs = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      return bMs - aMs || a.display_name.localeCompare(b.display_name);
    });

  return (
    <>
      <LivePageRefresh intervalMs={10000} />
      <DashboardClient
        runs={runs}
        collectionSources={collectionSources}
        totalRuns={stats.totalRuns}
        criticalFindings={stats.criticalFindings}
        environmentsAnalyzed={stats.environmentsAnalyzed}
        suppressedNoise={stats.suppressedNoise}
        severityDistribution={stats.severityDistribution}
        environmentMix={stats.environmentMix}
      />
    </>
  );
}
