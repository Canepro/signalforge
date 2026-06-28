import type { MacDiskPressureReportContext, PreFinding, ReportContext } from "./schema";

type CleanupSummary = {
  review_buckets?: Record<string, unknown>;
};

function parseFloatField(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerField(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonField<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function capacityBand(usedPercent: number | null): MacDiskPressureReportContext["root_volume"]["capacity_band"] {
  if (usedPercent === null) return "unknown";
  if (usedPercent >= 95) return "urgent";
  if (usedPercent >= 85) return "warning";
  return "normal";
}

function freeSpaceBand(finalFreeBytes: number | null): MacDiskPressureReportContext["root_volume"]["free_space_band"] {
  if (finalFreeBytes === null) return "unknown";
  const gib = finalFreeBytes / 1024 ** 3;
  if (gib < 20) return "urgent";
  if (gib < 50) return "warning";
  return "normal";
}

function cleanupFreshness(
  status: string,
  ageHours: number | null
): MacDiskPressureReportContext["daily_cleanup"]["freshness"] {
  if (status === "missing" || status === "invalid" || status === "stale") return status;
  if (status === "fresh") return "fresh";
  if (ageHours === null) return "unknown";
  return ageHours > 48 ? "stale" : "fresh";
}

function countBucket(summary: CleanupSummary | null, bucket: string): number {
  const raw = summary?.review_buckets?.[bucket];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function domainForRule(ruleId: string): { domain: "housekeeping" | "availability_risk"; reason: string } | null {
  if (
    ruleId === "mac.daily_cleanup_prune_candidates" ||
    ruleId === "mac.daily_cleanup_stale_review_candidates" ||
    ruleId === "mac.daily_cleanup_large_protected_stores"
  ) {
    return {
      domain: "housekeeping",
      reason: "cleanup backlog or retained local store; SignalForge detects and prioritizes, Mira/Codex owns workstation action",
    };
  }

  if (
    ruleId === "mac.disk_pressure" ||
    ruleId === "mac.disk_pressure_operational_posture" ||
    ruleId === "mac.daily_cleanup_ineffective_under_pressure"
  ) {
    return {
      domain: "availability_risk",
      reason: "root volume pressure can affect writes, builds, package operations, and local automation reliability",
    };
  }

  if (
    ruleId === "mac.daily_cleanup_report_stale" ||
    ruleId === "mac.daily_cleanup_report_missing" ||
    ruleId === "mac.daily_cleanup_report_invalid"
  ) {
    return {
      domain: "housekeeping",
      reason: "cleanup metadata is stale or unavailable, reducing confidence in workstation cleanup posture",
    };
  }

  return null;
}

export function riskDomainForPreFinding(
  finding: Pick<PreFinding, "rule_id" | "category">
): "housekeeping" | "availability_risk" | "security" | "network" | "resource" | "unknown" {
  const macDomain = domainForRule(finding.rule_id);
  if (macDomain) return macDomain.domain;
  if (finding.category === "security") return "security";
  if (finding.category === "network") return "network";
  if (finding.category === "disk") return "availability_risk";
  if (finding.category === "resource") return "resource";
  return "unknown";
}

export function buildReportContext(
  artifactType: string,
  sections: Record<string, string>,
  preFindings: PreFinding[]
): ReportContext | undefined {
  if (artifactType !== "mac-diagnostics") return undefined;

  const usedPercent = parseFloatField(sections.disk_root_used_percent);
  const finalFreeBytes = parseIntegerField(sections.daily_cleanup_final_free_bytes);
  const cleanupSummary = parseJsonField<CleanupSummary>(sections.daily_cleanup_needs_review_summary_json);
  const status = (sections.daily_cleanup_report_status ?? "unknown").trim() || "unknown";
  const ageHours = parseFloatField(sections.daily_cleanup_report_age_hours);
  const cleanup: MacDiskPressureReportContext = {
    kind: "mac-disk-cleanup",
    root_volume: {
      used_percent: usedPercent,
      capacity_band: capacityBand(usedPercent),
      final_free_bytes: finalFreeBytes,
      free_space_band: freeSpaceBand(finalFreeBytes),
    },
    daily_cleanup: {
      report_status: status,
      age_hours: ageHours,
      freshness: cleanupFreshness(status, ageHours),
      final_free_bytes: finalFreeBytes,
      free_space_delta_bytes: parseIntegerField(sections.daily_cleanup_free_space_delta_bytes),
      needs_review_count: parseIntegerField(sections.daily_cleanup_needs_review_count),
      stale_manual_review_candidates: countBucket(cleanupSummary, "stale_candidate"),
      missing_path_prune_candidates: countBucket(cleanupSummary, "missing_path_prune_candidate"),
    },
    finding_domains: preFindings
      .map((finding) => {
        const mapped = domainForRule(finding.rule_id);
        return mapped ? { rule_id: finding.rule_id, ...mapped } : null;
      })
      .filter((value): value is MacDiskPressureReportContext["finding_domains"][number] => value !== null),
  };

  if (
    usedPercent === null &&
    finalFreeBytes === null &&
    status === "unknown" &&
    cleanup.finding_domains.length === 0
  ) {
    return undefined;
  }

  return { mac_disk_cleanup: cleanup };
}
