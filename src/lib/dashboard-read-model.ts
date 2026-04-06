import type { CollectionPulseData, CollectionPulseDay } from "@/components/collection-pulse";
import type { DashboardOperationalHighlight } from "@/components/dashboard-operational-highlights";
import type { DashboardOperationalWatchLane } from "@/lib/dashboard-operational-watch";
import { buildDashboardOperationalWatch } from "@/lib/dashboard-operational-watch";
import { buildRunEvidenceSummary } from "@/lib/run-evidence-presentation";
import type { Storage, SourceView } from "@/lib/storage/contract";
import { runAttentionScore } from "@/lib/storage/shared/run-shared";
import type { RunSummary } from "@/types/api";
import type { ArtifactType } from "@/lib/source-catalog";

interface DashboardStats {
  totalRuns: number;
  criticalFindings: number;
  environmentsAnalyzed: number;
  suppressedNoise: number;
  severityDistribution: Record<string, number>;
}

export interface DashboardCollectionSourceReadModel {
  id: string;
  display_name: string;
  target_identifier: string;
  expected_artifact_type: ArtifactType;
  last_seen_at: string | null;
  default_collection_scope: SourceView["default_collection_scope"];
}

export interface DashboardReadModel {
  runs: RunSummary[];
  collectionSources: DashboardCollectionSourceReadModel[];
  totalRuns: number;
  criticalFindings: number;
  environmentsAnalyzed: number;
  suppressedNoise: number;
  severityDistribution: Record<string, number>;
  collectionPulse: CollectionPulseData;
  operationalWatch: DashboardOperationalWatchLane[];
  operationalHighlights: DashboardOperationalHighlight[];
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

    days.push({
      date: key,
      label: dayLabelFormatter.format(day),
      count,
      level: 0,
      maxSeverity: severityByDay.get(key) ?? null,
      isToday: offset === 0,
    });
  }
  const maxVisibleCount = days.reduce((max, day) => Math.max(max, day.count), 0);
  const normalizedDays = days.map((day) => {
    const ratio = maxVisibleCount > 0 ? day.count / maxVisibleCount : 0;
    const level: CollectionPulseDay["level"] =
      day.count === 0 ? 0
      : ratio >= 0.75 ? 4
      : ratio >= 0.5 ? 3
      : ratio >= 0.25 ? 2
      : 1;
    return {
      ...day,
      level,
    };
  });

  const configuredSources = sourceStates.filter((entry) => entry.hasRegistration).length;
  const onlineSources = sourceStates.filter(
    (entry) => entry.hasRegistration && entry.source.health_status === "online"
  ).length;
  const collectionsLast7d = normalizedDays.slice(-7).reduce((total, day) => total + day.count, 0);
  const elevatedDays = normalizedDays.filter(
    (day) => day.maxSeverity === "critical" || day.maxSeverity === "high"
  ).length;
  const lastCollectionRun = runs.reduce<RunSummary | null>((latest, run) => {
    if (!latest) return run;
    return new Date(run.created_at).getTime() > new Date(latest.created_at).getTime() ? run : latest;
  }, null);

  return {
    days: normalizedDays,
    onlineSources,
    configuredSources,
    collectionsLast7d,
    elevatedDays,
    lastCollectionLabel: lastCollectionRun ? formatRelativeTime(lastCollectionRun.created_at, nowMs) : null,
  };
}

export async function loadDashboardReadModel(
  storage: Storage,
  nowMs = Date.now()
): Promise<DashboardReadModel> {
  const runs = (await storage.runs.listSummaries()).map((run) => ({
    ...run,
    created_at_label: formatRelativeTime(run.created_at, nowMs),
  }));

  const stats = computeStats(runs);
  stats.suppressedNoise = await storage.runs.countSuppressedNoise();

  const sourceStates = await storage.sources.listDashboardCollectionSourceStates({ enabled: true });

  const collectionSources = (
    sourceStates
      .map(({ source, hasRegistration }) => {
        if (!hasRegistration || source.health_status !== "online") return null;
        return {
          id: source.id,
          display_name: source.display_name,
          target_identifier: source.target_identifier,
          expected_artifact_type: source.expected_artifact_type as ArtifactType,
          last_seen_at: source.last_seen_at,
          default_collection_scope: source.default_collection_scope,
        } satisfies DashboardCollectionSourceReadModel;
      })
  )
    .filter((source): source is DashboardCollectionSourceReadModel => source !== null)
    .sort((a, b) => {
      const aMs = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const bMs = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      return bMs - aMs || a.display_name.localeCompare(b.display_name);
    });

  const collectionPulse = buildCollectionPulse(runs, sourceStates, nowMs);

  const signalRuns = await storage.runs.listDashboardSignalRuns(12);

  const operationalWatch: DashboardOperationalWatchLane[] = buildDashboardOperationalWatch(
    signalRuns.map((entry) => ({
      run: entry.run,
      target_name: entry.run.target_identifier ?? entry.run.hostname ?? "Target not recorded",
      findings: entry.findings,
    }))
  );

  const operationalHighlights: DashboardOperationalHighlight[] = [];
  for (const entry of [...signalRuns]
    .sort((a, b) => runAttentionScore(b.run) - runAttentionScore(a.run))
    .slice(0, 6)) {
    const sections = buildRunEvidenceSummary(entry.run.artifact_type, entry.findings).sections.slice(0, 2);
    if (sections.length === 0) continue;
    operationalHighlights.push({
      run_id: entry.run.id,
      filename: entry.run.filename,
      target_name: entry.run.target_identifier ?? entry.run.hostname ?? "Target not recorded",
      created_at_label: formatRelativeTime(entry.run.created_at, nowMs),
      sections,
    });
    if (operationalHighlights.length >= 3) break;
  }

  return {
    runs,
    collectionSources,
    totalRuns: stats.totalRuns,
    criticalFindings: stats.criticalFindings,
    environmentsAnalyzed: stats.environmentsAnalyzed,
    suppressedNoise: stats.suppressedNoise,
    severityDistribution: stats.severityDistribution,
    collectionPulse,
    operationalWatch,
    operationalHighlights,
  };
}
