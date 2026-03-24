import { getDb } from "@/lib/db/client";
import { listRuns, deriveSeverityCounts } from "@/lib/db/repository";
import { DashboardClient } from "./dashboard-client";
import type { RunSummary } from "@/types/api";

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

async function computeNoiseCount(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<number> {
  const stmt = db.prepare("SELECT noise_json FROM runs WHERE noise_json IS NOT NULL");
  let total = 0;
  while (stmt.step()) {
    const row = stmt.getAsObject() as { noise_json: string | null };
    if (row.noise_json) {
      try {
        const items = JSON.parse(row.noise_json);
        if (Array.isArray(items)) total += items.length;
      } catch {
        /* skip */
      }
    }
  }
  stmt.free();
  return total;
}

export default async function DashboardPage() {
  const db = await getDb();
  const nowMs = Date.now();
  const runs = listRuns(db).map((run) => ({
    ...run,
    created_at_label: formatRelativeTime(run.created_at, nowMs),
  }));
  const stats = computeStats(runs);
  stats.suppressedNoise = await computeNoiseCount(db);

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
