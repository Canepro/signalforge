import { DashboardClient } from "./dashboard-client";
import type { RunSummary } from "@/types/api";
import { getStorage } from "@/lib/storage";

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
  const hostnames = new Set<string>();
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

    if (run.hostname) hostnames.add(run.hostname);

    for (const tag of run.env_tags) {
      envMix[tag] = (envMix[tag] ?? 0) + 1;
    }
  }

  return {
    totalRuns: runs.length,
    criticalFindings,
    environmentsAnalyzed: hostnames.size,
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

  return (
    <DashboardClient
      runs={runs}
      totalRuns={stats.totalRuns}
      criticalFindings={stats.criticalFindings}
      environmentsAnalyzed={stats.environmentsAnalyzed}
      suppressedNoise={stats.suppressedNoise}
      severityDistribution={stats.severityDistribution}
      environmentMix={stats.environmentMix}
    />
  );
}
