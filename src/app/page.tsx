import { DashboardClient } from "./dashboard-client";
import { LivePageRefresh } from "@/components/live-page-refresh";
import type { CollectionPulseData, CollectionPulseDay } from "@/components/collection-pulse";
import type { DashboardOperationalHighlight } from "@/components/dashboard-operational-highlights";
import { buildRunEvidenceSections } from "@/lib/run-evidence-presentation";
import type { ArtifactType } from "@/lib/source-catalog";
import type { SourceView } from "@/lib/storage/contract";
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

  for (const run of runs) {
    const counts = run.severity_counts;
    criticalFindings += counts.critical ?? 0;
    distribution.critical += counts.critical ?? 0;
    distribution.high += counts.high ?? 0;
    distribution.medium += counts.medium ?? 0;
    distribution.low += counts.low ?? 0;

    const logicalTarget = run.target_identifier || run.hostname || null;
    if (logicalTarget) logicalTargets.add(logicalTarget);
  }

  return {
    totalRuns: runs.length,
    criticalFindings,
    environmentsAnalyzed: logicalTargets.size,
    suppressedNoise,
    severityDistribution: distribution,
  };
}

function toUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function maxSeverityForRun(run: RunSummary): CollectionPulseDay["maxSeverity"] {
  const counts = run.severity_counts;
  if ((counts.critical ?? 0) > 0) return "critical";
  if ((counts.high ?? 0) > 0) return "high";
  if ((counts.medium ?? 0) > 0) return "medium";
  if ((counts.low ?? 0) > 0) return "low";
  return null;
}

function buildCollectionPulse(
  runs: RunSummary[],
  sourceStates: Array<{ source: SourceView; hasRegistration: boolean }>,
  nowMs: number
): CollectionPulseData {
  const today = new Date(nowMs);
  today.setUTCHours(0, 0, 0, 0);

  const countsByDay = new Map<string, number>();
  const severityByDay = new Map<string, CollectionPulseDay["maxSeverity"]>();
  const severityRank: Record<Exclude<CollectionPulseDay["maxSeverity"], null>, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  for (const run of runs) {
    const dayKey = run.created_at.slice(0, 10);
    countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1);

    const nextSeverity = maxSeverityForRun(run);
    const currentSeverity = severityByDay.get(dayKey) ?? null;
    if (
      nextSeverity &&
      (!currentSeverity || severityRank[nextSeverity] > severityRank[currentSeverity])
    ) {
      severityByDay.set(dayKey, nextSeverity);
    }
  }

  const rawCounts = Array.from(countsByDay.values());
  const maxCount = rawCounts.length > 0 ? Math.max(...rawCounts) : 0;
  const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });

  const days: CollectionPulseDay[] = [];
  for (let offset = 41; offset >= 0; offset--) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - offset);
    const key = toUtcDayKey(day);
    const count = countsByDay.get(key) ?? 0;
    const ratio = maxCount > 0 ? count / maxCount : 0;
    const level: CollectionPulseDay["level"] =
      count === 0 ? 0
      : ratio >= 0.75 ? 4
      : ratio >= 0.5 ? 3
      : ratio >= 0.25 ? 2
      : 1;

    days.push({
      date: key,
      label: dayLabelFormatter.format(day),
      count,
      level,
      maxSeverity: severityByDay.get(key) ?? null,
      isToday: offset === 0,
    });
  }

  const configuredSources = sourceStates.filter((entry) => entry.hasRegistration).length;
  const onlineSources = sourceStates.filter(
    (entry) => entry.hasRegistration && entry.source.health_status === "online"
  ).length;
  const collectionsLast7d = days.slice(-7).reduce((total, day) => total + day.count, 0);
  const elevatedDays = days.filter(
    (day) => day.maxSeverity === "critical" || day.maxSeverity === "high"
  ).length;
  const lastCollectionRun = runs.reduce<RunSummary | null>((latest, run) => {
    if (!latest) return run;
    return new Date(run.created_at).getTime() > new Date(latest.created_at).getTime() ? run : latest;
  }, null);

  return {
    days,
    onlineSources,
    configuredSources,
    collectionsLast7d,
    elevatedDays,
    lastCollectionLabel: lastCollectionRun ? formatRelativeTime(lastCollectionRun.created_at, nowMs) : null,
  };
}

function runAttentionScore(run: RunSummary) {
  return (
    (run.severity_counts.critical ?? 0) * 1000 +
    (run.severity_counts.high ?? 0) * 100 +
    (run.severity_counts.medium ?? 0) * 10 +
    (run.severity_counts.low ?? 0)
  );
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
  const sourceStates = await Promise.all(
    sources.map(async (source) => {
      const registration = await storage.agents.getRegistrationBySourceId(source.id);
      return {
        source,
        hasRegistration: registration !== null,
        registration,
      };
    })
  );
  const collectionSources = (
    sourceStates
      .map(({ source, registration }) => {
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
    .filter((source): source is DashboardCollectionSource => source !== null)
    .sort((a, b) => {
      const aMs = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const bMs = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      return bMs - aMs || a.display_name.localeCompare(b.display_name);
    });
  const collectionPulse = buildCollectionPulse(runs, sourceStates, nowMs);
  const operationalHighlights: DashboardOperationalHighlight[] = [];
  for (const run of [...runs]
    .filter((candidate) => runAttentionScore(candidate) > 0)
    .sort((a, b) => runAttentionScore(b) - runAttentionScore(a))
    .slice(0, 6)) {
    const detail = await storage.runs.getPageDetail(run.id);
    const sections = buildRunEvidenceSections(
      detail?.artifact_type ?? run.artifact_type,
      detail?.report?.findings ?? []
    ).slice(0, 2);
    if (sections.length === 0) continue;
    operationalHighlights.push({
      run_id: run.id,
      filename: run.filename,
      target_name: run.target_identifier ?? run.hostname ?? "Target not recorded",
      created_at_label: run.created_at_label ?? run.created_at,
      sections,
    });
    if (operationalHighlights.length >= 3) break;
  }

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
        collectionPulse={collectionPulse}
        operationalHighlights={operationalHighlights}
      />
    </>
  );
}
