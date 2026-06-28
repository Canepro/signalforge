import type { PreFinding } from "../../analyzer/schema";
import {
  classifyDiskPressureBand,
  severityForDiskPressureBand,
  type DiskPressureBand,
} from "./disk-pressure";
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
  const pressureBand = classifyDiskPressureBand(diskUsedPercent);
  const pressureSeverity = pressureBand ? severityForDiskPressureBand(pressureBand) : null;

  if (pressureBand && cleanup.status !== "present") {
    const statusDetail =
      cleanup.status === "stale" && cleanup.ageHours !== null ?
        `latest cleanup report is ${cleanup.ageHours.toFixed(1)} hours old`
      : cleanup.status === "invalid" && cleanup.error ?
        `latest cleanup report could not be parsed (${cleanup.error})`
      : cleanup.status === "missing" ? "no cleanup report was found for this workstation"
      : `cleanup report status is ${cleanup.status}`;

    findings.push({
      title: `Daily cleanup metadata is ${cleanup.status} while root volume disk pressure is ${pressureBand}`,
      severity_hint: pressureSeverity!,
      category: "resource",
      section_source: "daily_cleanup_report_status",
      evidence:
        `${statusDetail}; pressure_band=${pressureBand}; ` +
        `disk_root_used_percent=${sections.disk_root_used_percent ?? "unknown"}`,
      rule_id: `mac.daily_cleanup_report_${cleanup.status}`,
    });
  }

  const staleCandidates =
    cleanup.needsReviewSummary?.review_buckets?.stale_candidate ?? 0;
  if (staleCandidates > 0) {
    const severity =
      pressureBand === "urgent" ? "medium"
      : pressureBand === "warning" ? "low"
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

  if (pressureBand && cleanup.retainedLargeStores.length > 0) {
    const topStores = cleanup.retainedLargeStores
      .slice(0, 3)
      .map((store) => `${store.path ?? "unknown store"} (${formatBytes(store.size_bytes)})`)
      .join("; ");
    findings.push({
      title: `Protected retained stores remain large while root volume disk pressure is ${pressureBand}`,
      severity_hint: pressureSeverity!,
      category: "resource",
      section_source: "daily_cleanup_retained_large_stores_json",
      evidence:
        `${topStores}; reclaimed=${reclaimedSummary(cleanup.reclaimedByCategory)}; ` +
        `pressure_band=${pressureBand}`,
      rule_id: "mac.daily_cleanup_large_protected_stores",
    });
  }

  if (pressureBand) {
    findings.push(...extractCleanupPressureCorrelationFindings(cleanup, pressureBand, diskUsedPercent));
  }

  return findings;
}

function signedFormatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return "unknown";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.abs(bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${value.toFixed(precision)} ${units[unitIndex]}`;
}

function cleanupEffectivenessLabel(deltaBytes: number | null): string {
  if (deltaBytes === null) return "unknown";
  if (deltaBytes < 0) return "negative";
  if (deltaBytes === 0) return "flat";
  return "positive";
}

function retainedStoreBytes(stores: RetainedLargeStore[]): number {
  return stores.reduce((total, store) => {
    const size = store.size_bytes;
    return typeof size === "number" && Number.isFinite(size) ? total + size : total;
  }, 0);
}

function extractCleanupPressureCorrelationFindings(
  cleanup: DailyCleanupInfo,
  pressureBand: DiskPressureBand,
  diskUsedPercent: number | null
): PreFinding[] {
  const findings: PreFinding[] = [];
  const usedLabel =
    typeof diskUsedPercent === "number" && Number.isFinite(diskUsedPercent) ?
      diskUsedPercent.toFixed(1)
    : "unknown";
  const deltaBytes = cleanup.deltaBytes;
  const staleCandidates = cleanup.needsReviewSummary?.review_buckets?.stale_candidate ?? 0;
  const retainedStoreCount = cleanup.retainedLargeStores.length;
  const retainedBytes = retainedStoreBytes(cleanup.retainedLargeStores);
  const effectiveness = cleanupEffectivenessLabel(deltaBytes);
  const hasCleanupDrift =
    cleanup.status !== "present" ||
    effectiveness !== "positive" ||
    staleCandidates > 0 ||
    retainedStoreCount > 0;

  if (!hasCleanupDrift) {
    return findings;
  }

  const bandSeverity = severityForDiskPressureBand(pressureBand);
  const correlationSeverity =
    pressureBand === "urgent" &&
    (cleanup.status !== "present" || effectiveness === "negative" || staleCandidates > 0) ?
      "high"
    : bandSeverity;

  findings.push({
    title: `Mac ${pressureBand} disk pressure correlates with cleanup posture drift`,
    severity_hint: correlationSeverity,
    category: "resource",
    section_source: "daily_cleanup_report_status",
    evidence: [
      `pressure_band=${pressureBand}`,
      `disk_root_used_percent=${usedLabel}`,
      `cleanup_report_status=${cleanup.status}`,
      cleanup.ageHours !== null ? `cleanup_report_age_hours=${cleanup.ageHours.toFixed(1)}` : null,
      deltaBytes !== null ? `cleanup_free_space_delta_bytes=${deltaBytes}` : null,
      `cleanup_effectiveness=${effectiveness}`,
      `retained_large_store_count=${retainedStoreCount}`,
      retainedBytes > 0 ? `retained_large_store_bytes=${retainedBytes}` : null,
      `stale_review_candidates=${staleCandidates}`,
      cleanup.needsReviewCount !== null ? `needs_review_count=${cleanup.needsReviewCount}` : null,
    ]
      .filter(Boolean)
      .join("; "),
    rule_id: "mac.disk_pressure_operational_posture",
  });

  if (deltaBytes !== null && deltaBytes <= 0) {
    findings.push({
      title: `Latest daily cleanup did not increase free space while disk pressure is ${pressureBand}`,
      severity_hint: pressureBand === "urgent" ? "high" : "medium",
      category: "resource",
      section_source: "daily_cleanup_free_space_delta_bytes",
      evidence:
        `cleanup_free_space_delta_bytes=${deltaBytes} (${signedFormatBytes(deltaBytes)}); ` +
        `cleanup_report_status=${cleanup.status}; disk_root_used_percent=${usedLabel}`,
      rule_id: "mac.daily_cleanup_ineffective_under_pressure",
    });
  }

  return findings;
}
