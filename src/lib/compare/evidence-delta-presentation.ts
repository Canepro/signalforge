import type { RunEvidenceSection } from "@/lib/run-evidence-presentation";
import type {
  EvidenceDeltaMetricRow,
  EvidenceDeltaPayload,
} from "@/lib/compare/evidence-delta";

export type EvidenceMetricFocus =
  | "all"
  | "rollout"
  | "pressure"
  | "runtime"
  | "posture";

export const EVIDENCE_METRIC_FOCUS_DEFINITIONS: Array<{
  value: Exclude<EvidenceMetricFocus, "all">;
  label: string;
}> = [
  { value: "rollout", label: "Rollout" },
  { value: "pressure", label: "Pressure" },
  { value: "runtime", label: "Runtime health" },
  { value: "posture", label: "Posture" },
];

function formatMetricValue(value: EvidenceDeltaMetricRow["previous"], unit: string | null): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (unit === "bytes" && typeof value === "number") {
    if (value === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const scaled = value / 1024 ** exponent;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
  }
  return String(value);
}

export function classifyEvidenceMetricFocus(row: EvidenceDeltaMetricRow): EvidenceMetricFocus {
  if (row.family === "container-diagnostics") {
    if (["state_status", "health_status", "restart_count", "oom_killed", "memory_limit_bytes", "memory_reservation_bytes"].includes(row.key)) {
      return "runtime";
    }
    return "posture";
  }

  if (row.family === "kubernetes-bundle") {
    if (
      [
        "rollout_issue_count",
        "unavailable_replica_count",
        "hpa_issue_count",
        "pdb_blocking_count",
      ].includes(row.key)
    ) {
      return "rollout";
    }
    if (
      [
        "warning_event_count",
        "node_not_ready_count",
        "node_pressure_count",
        "resource_quota_pressure_count",
        "pending_persistent_volume_claim_count",
        "persistent_volume_claim_resize_pending_count",
        "degraded_persistent_volume_count",
        "workload_pending_persistent_volume_claim_count",
      ].includes(row.key)
    ) {
      return "pressure";
    }
    return "posture";
  }

  return "posture";
}

export function buildOperationalEvidenceDeltaSections(
  evidenceDelta: EvidenceDeltaPayload | null
): RunEvidenceSection[] {
  if (!evidenceDelta) return [];

  const metrics = evidenceDelta.metrics.filter((row) =>
    row.family === "container-diagnostics" || row.family === "kubernetes-bundle"
  );
  if (metrics.length === 0) return [];

  const sectionsByFocus = new Map<Exclude<EvidenceMetricFocus, "all">, RunEvidenceSection>();
  for (const focus of EVIDENCE_METRIC_FOCUS_DEFINITIONS) {
    sectionsByFocus.set(focus.value, {
      id: `compare-${focus.value}`,
      title: focus.label,
      summary:
        focus.value === "rollout"
          ? "Replica availability and controller reconciliation changes between the two runs."
          : focus.value === "pressure"
            ? "Cluster pressure and warning-event changes between the two runs."
            : focus.value === "runtime"
              ? "Container runtime-health changes between the two runs."
              : "Security and posture changes between the two runs.",
      tone:
        focus.value === "rollout" || focus.value === "pressure" || focus.value === "runtime"
          ? "warning"
          : "neutral",
      entries: [],
    });
  }

  for (const row of metrics) {
    const focus = classifyEvidenceMetricFocus(row);
    if (focus === "all") continue;
    sectionsByFocus.get(focus)?.entries.push({
      label: row.label,
      value: `${formatMetricValue(row.previous, row.unit)} -> ${formatMetricValue(row.current, row.unit)}`,
      emphasis: true,
    });
  }

  return Array.from(sectionsByFocus.values()).filter((section) => section.entries.length > 0);
}
