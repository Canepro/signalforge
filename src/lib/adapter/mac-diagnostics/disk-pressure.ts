import type { PreFinding } from "../../analyzer/schema";

export type DiskPressureBand = "warning" | "urgent";

export const DISK_PRESSURE_WARNING_THRESHOLD = 85;
export const DISK_PRESSURE_URGENT_THRESHOLD = 95;

export function classifyDiskPressureBand(usedPercent: number | null): DiskPressureBand | null {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
    return null;
  }
  if (usedPercent >= DISK_PRESSURE_URGENT_THRESHOLD) {
    return "urgent";
  }
  if (usedPercent >= DISK_PRESSURE_WARNING_THRESHOLD) {
    return "warning";
  }
  return null;
}

export function severityForDiskPressureBand(band: DiskPressureBand): "medium" | "high" {
  return band === "urgent" ? "high" : "medium";
}

export function extractDiskPressureFindings(
  sections: Record<string, string>,
  diskUsedPercent: number | null
): PreFinding[] {
  const band = classifyDiskPressureBand(diskUsedPercent);
  if (!band) return [];

  const usedLabel = diskUsedPercent!.toFixed(1);
  return [
    {
      title: `Mac root volume disk pressure is ${band} (${usedLabel}% used)`,
      severity_hint: severityForDiskPressureBand(band),
      category: "resource",
      section_source: "disk_root_used_percent",
      evidence:
        `pressure_band=${band}; disk_root_used_percent=${sections.disk_root_used_percent ?? usedLabel}; ` +
        `warning_threshold=${DISK_PRESSURE_WARNING_THRESHOLD}; urgent_threshold=${DISK_PRESSURE_URGENT_THRESHOLD}`,
      rule_id: "mac.disk_pressure",
    },
  ];
}