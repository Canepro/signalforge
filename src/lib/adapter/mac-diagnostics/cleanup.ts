import type { PreFinding } from "../../analyzer/schema";
import {
  macValueFor,
  parseMacFloat,
  parseMacInteger,
  parseMacJson,
} from "./parse";

type CleanupStatus = "present" | "stale" | "missing" | "invalid";

type NeedsReviewCandidate = {
  path?: string;
  reason?: string;
  age_days?: number | null;
  suggested_follow_up?: string;
};

type NeedsReviewSummary = {
  total: number;
  review_buckets: {
    protected_outside_home?: number;
    recent_or_unknown_age?: number;
    missing_path_prune_candidate?: number;
    stale_candidate?: number;
    other?: number;
  };
  priority_review_candidates?: NeedsReviewCandidate[];
};

type RetainedLargeStore = {
  path?: string;
  size_bytes?: number | null;
  reason?: string;
};

type DailyCleanupInfo = {
  status: CleanupStatus;
  ageHours: number | null;
  error: string;
  finalFreeBytes: number | null;
  deltaBytes: number | null;
  activeCacheSkipsCount: number | null;
  needsReviewCount: number | null;
  reclaimedByCategory: Record<string, number>;
  needsReviewSummary: NeedsReviewSummary | null;
  retainedLargeStores: RetainedLargeStore[];
};

function parseCleanupStatus(raw: string): CleanupStatus | null {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "present" ||
    normalized === "stale" ||
    normalized === "missing" ||
    normalized === "invalid"
  ) {
    return normalized;
  }
  return null;
}

function parseJsonMapNumber(raw: string): Record<string, number> {
  const parsed = parseMacJson<Record<string, unknown>>(raw);
  if (!parsed || Array.isArray(parsed)) return {};

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

function parseNeedsReviewSummary(raw: string): NeedsReviewSummary | null {
  const parsed = parseMacJson<NeedsReviewSummary>(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function parseRetainedLargeStores(raw: string): RetainedLargeStore[] {
  const parsed = parseMacJson<RetainedLargeStore[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function severityForDiskPressure(diskUsedPercent: number): "medium" | "high" {
  return diskUsedPercent >= 95 ? "high" : "medium";
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "unknown size";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function topCandidateSummary(candidates: NeedsReviewCandidate[], limit = 2): string {
  return candidates
    .slice(0, limit)
    .map((candidate) => {
      const path = candidate.path ?? "unknown path";
      const age =
        typeof candidate.age_days === "number" && Number.isFinite(candidate.age_days) ?
          ` (${candidate.age_days.toFixed(1)}d old)`
        : "";
      return `${path}${age}`;
    })
    .join("; ");
}

function reclaimedSummary(reclaimedByCategory: Record<string, number>): string {
  const entries = Object.entries(reclaimedByCategory).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "no reclaimed categories recorded";
  return entries
    .slice(0, 3)
    .map(([category, bytes]) => `${category}=${formatBytes(bytes)}`)
    .join(", ");
}

function readDailyCleanupInfo(sections: Record<string, string>): DailyCleanupInfo | null {
  const status = parseCleanupStatus(macValueFor(sections, "daily_cleanup_report_status"));
  if (!status) return null;

  return {
    status,
    ageHours: parseMacFloat(sections.daily_cleanup_report_age_hours),
    error: macValueFor(sections, "daily_cleanup_report_error"),
    finalFreeBytes: parseMacInteger(sections.daily_cleanup_final_free_bytes),
    deltaBytes: parseMacInteger(sections.daily_cleanup_free_space_delta_bytes),
    activeCacheSkipsCount: parseMacInteger(sections.daily_cleanup_active_cache_skips_count),
    needsReviewCount: parseMacInteger(sections.daily_cleanup_needs_review_count),
    reclaimedByCategory: parseJsonMapNumber(
      macValueFor(sections, "daily_cleanup_reclaimed_by_category_json")
    ),
    needsReviewSummary: parseNeedsReviewSummary(
      macValueFor(sections, "daily_cleanup_needs_review_summary_json")
    ),
    retainedLargeStores: parseRetainedLargeStores(
      macValueFor(sections, "daily_cleanup_retained_large_stores_json")
    ),
  };
}

export function extractDailyCleanupFindings(
  sections: Record<string, string>,
  diskUsedPercent: number | null
): PreFinding[] {
  const cleanup = readDailyCleanupInfo(sections);
  if (!cleanup) return [];

  const findings: PreFinding[] = [];
  const underPressure =
    typeof diskUsedPercent === "number" && Number.isFinite(diskUsedPercent) && diskUsedPercent >= 85;
  const pressureSeverity =
    underPressure && diskUsedPercent !== null ? severityForDiskPressure(diskUsedPercent) : null;

  if (pressureSeverity && cleanup.status !== "present") {
    const statusDetail =
      cleanup.status === "stale" && cleanup.ageHours !== null ?
        `latest cleanup report is ${cleanup.ageHours.toFixed(1)} hours old`
      : cleanup.status === "invalid" && cleanup.error ?
        `latest cleanup report could not be parsed (${cleanup.error})`
      : cleanup.status === "missing" ? "no cleanup report was found for this workstation"
      : `cleanup report status is ${cleanup.status}`;

    findings.push({
      title: `Daily cleanup metadata is ${cleanup.status} while root volume usage is elevated`,
      severity_hint: pressureSeverity,
      category: "resource",
      section_source: "daily_cleanup_report_status",
      evidence: `${statusDetail}; disk_root_used_percent=${sections.disk_root_used_percent ?? "unknown"}`,
      rule_id: `mac.daily_cleanup_report_${cleanup.status}`,
    });
  }

  const staleCandidates =
    cleanup.needsReviewSummary?.review_buckets?.stale_candidate ?? 0;
  if (staleCandidates > 0) {
    const severity =
      pressureSeverity === "high" ? "medium"
      : "low";
    const candidates = cleanup.needsReviewSummary?.priority_review_candidates ?? [];
    findings.push({
      title:
        staleCandidates === 1 ?
          "Daily cleanup retained one stale manual review candidate"
        : `Daily cleanup retained ${staleCandidates} stale manual review candidates`,
      severity_hint: severity,
      category: "resource",
      section_source: "daily_cleanup_needs_review_summary_json",
      evidence:
        candidates.length > 0 ?
          `${topCandidateSummary(candidates)}; needs_review_count=${cleanup.needsReviewCount ?? "unknown"}`
        : `needs_review_count=${cleanup.needsReviewCount ?? "unknown"}`,
      rule_id: "mac.daily_cleanup_stale_review_candidates",
    });
  }

  const pruneCandidates =
    cleanup.needsReviewSummary?.review_buckets?.missing_path_prune_candidate ?? 0;
  if (pruneCandidates > 0) {
    findings.push({
      title:
        pruneCandidates === 1 ?
          "Daily cleanup found one linked-worktree prune candidate"
        : `Daily cleanup found ${pruneCandidates} linked-worktree prune candidates`,
      severity_hint: "low",
      category: "resource",
      section_source: "daily_cleanup_needs_review_summary_json",
      evidence: `priority candidates=${topCandidateSummary(
        cleanup.needsReviewSummary?.priority_review_candidates ?? []
      )}`,
      rule_id: "mac.daily_cleanup_prune_candidates",
    });
  }

  if (pressureSeverity && cleanup.retainedLargeStores.length > 0) {
    const topStores = cleanup.retainedLargeStores
      .slice(0, 3)
      .map((store) => `${store.path ?? "unknown store"} (${formatBytes(store.size_bytes)})`)
      .join("; ");
    findings.push({
      title: "Protected retained stores remain large while root volume usage is elevated",
      severity_hint: pressureSeverity,
      category: "resource",
      section_source: "daily_cleanup_retained_large_stores_json",
      evidence: `${topStores}; reclaimed=${reclaimedSummary(cleanup.reclaimedByCategory)}`,
      rule_id: "mac.daily_cleanup_large_protected_stores",
    });
  }

  return findings;
}
