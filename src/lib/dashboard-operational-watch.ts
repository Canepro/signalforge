import type { Finding } from "@/lib/analyzer/schema";
import type { RunSummary } from "@/types/api";

export type DashboardOperationalWatchLaneId =
  | "failure"
  | "rollout"
  | "capacity"
  | "storage";

export interface DashboardOperationalWatchRun {
  run: RunSummary;
  target_name: string;
  findings: Finding[];
}

export interface DashboardOperationalWatchItem {
  run_id: string;
  label: string;
  detail: string;
  target_name: string;
  created_at_label: string;
}

export interface DashboardOperationalWatchLane {
  id: DashboardOperationalWatchLaneId;
  title: string;
  summary: string;
  tone: "critical" | "warning" | "neutral";
  run_count: number;
  items: DashboardOperationalWatchItem[];
}

type LaneState = DashboardOperationalWatchLane & {
  seen_runs: Set<string>;
};

function parseEvidenceJson(finding: Finding): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(finding.evidence) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function workloadTarget(namespace: string | null, name: string | null): string {
  return [namespace, name].filter(Boolean).join("/") || "unknown-workload";
}

function classifyFindingLane(finding: Finding): DashboardOperationalWatchLaneId | null {
  if (
    finding.section_source === "logs/unhealthy-workload-excerpts.json" ||
    finding.section_source === "failure_log_excerpts_json"
  ) {
    return "failure";
  }
  if (
    finding.section_source === "workloads/rollout-status.json" ||
    finding.section_source === "autoscaling/horizontal-pod-autoscalers.json" ||
    finding.section_source === "policy/pod-disruption-budgets.json"
  ) {
    return "rollout";
  }
  if (
    finding.section_source === "cluster/node-health.json" ||
    finding.section_source === "metrics/node-top.json" ||
    finding.section_source === "quotas/resource-quotas.json"
  ) {
    return "capacity";
  }
  if (
    finding.section_source === "storage/persistent-volume-claims.json" ||
    finding.section_source === "storage/persistent-volumes.json" ||
    (finding.section_source === "workloads/specs.json" &&
      (
        finding.title.startsWith("Kubernetes workload depends on a Pending PersistentVolumeClaim:") ||
        finding.title.startsWith(
          "Kubernetes workload depends on a PersistentVolumeClaim waiting for filesystem resize:"
        )
      ))
  ) {
    return "storage";
  }
  return null;
}

function buildFailureItem(
  run: RunSummary,
  targetName: string,
  finding: Finding
): DashboardOperationalWatchItem {
  const parsed = parseEvidenceJson(finding);
  if (finding.section_source === "logs/unhealthy-workload-excerpts.json") {
    const samples = Array.isArray(parsed?.samples)
      ? (parsed?.samples as Array<Record<string, unknown>>)
      : [];
    const firstSample = samples[0] ?? null;
    const reason =
      asStringArray(parsed?.reasons)[0] ??
      asString(firstSample?.reason) ??
      "failure";
    const firstLine = asStringArray(firstSample?.excerpt_lines)[0] ?? "Excerpt captured";
    const label = `${
      asString(parsed?.workload_kind) ?? "Workload"
    } ${workloadTarget(asString(parsed?.namespace), asString(parsed?.workload_name))}`;
    return {
      run_id: run.id,
      label,
      detail: `${reason} · ${firstLine}`,
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  const samples = Array.isArray(parsed?.samples)
    ? (parsed?.samples as Array<Record<string, unknown>>)
    : [];
  const firstSample = samples[0] ?? null;
  const source = asString(firstSample?.source) ?? "current";
  const reason = asString(firstSample?.reason) ?? "failure";
  const firstLine = asStringArray(firstSample?.excerpt_lines)[0] ?? "Excerpt captured";
  return {
    run_id: run.id,
    label: targetName,
    detail: `${reason} · ${source} logs · ${firstLine}`,
    target_name: targetName,
    created_at_label: run.created_at_label ?? run.created_at,
  };
}

function buildRolloutItem(
  run: RunSummary,
  targetName: string,
  finding: Finding
): DashboardOperationalWatchItem {
  const parsed = parseEvidenceJson(finding);
  if (finding.section_source === "workloads/rollout-status.json") {
    const label = `${
      asString(parsed?.kind) ?? "Workload"
    } ${workloadTarget(asString(parsed?.namespace), asString(parsed?.name))}`;
    if (finding.title.startsWith("Kubernetes rollout incomplete:")) {
      return {
        run_id: run.id,
        label,
        detail:
          `Ready ${asNumber(parsed?.ready_replicas) ?? "?"}/${asNumber(parsed?.desired_replicas) ?? "?"}`
          + ` · updated ${asNumber(parsed?.updated_replicas) ?? "?"}`
          + ` · unavailable ${asNumber(parsed?.unavailable_replicas) ?? "?"}`,
        target_name: targetName,
        created_at_label: run.created_at_label ?? run.created_at,
      };
    }
    return {
      run_id: run.id,
      label,
      detail:
        `Observed generation ${asNumber(parsed?.observed_generation) ?? "?"}`
        + ` of ${asNumber(parsed?.generation) ?? "?"}`,
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  if (finding.section_source === "autoscaling/horizontal-pod-autoscalers.json") {
    const label = `HPA ${workloadTarget(asString(parsed?.namespace), asString(parsed?.name))}`;
    if (finding.title.startsWith("Kubernetes HPA is saturated at max replicas:")) {
      return {
        run_id: run.id,
        label,
        detail:
          `Desired ${asNumber(parsed?.desired_replicas) ?? "?"}/${asNumber(parsed?.max_replicas) ?? "?"}`
          + (
            asNumber(parsed?.current_cpu_utilization_percentage) !== null &&
            asNumber(parsed?.target_cpu_utilization_percentage) !== null
              ? ` · CPU ${asNumber(parsed?.current_cpu_utilization_percentage)}% vs target ${asNumber(parsed?.target_cpu_utilization_percentage)}%`
              : ""
          ),
        target_name: targetName,
        created_at_label: run.created_at_label ?? run.created_at,
      };
    }
    return {
      run_id: run.id,
      label,
      detail: finding.title.replace("Kubernetes ", ""),
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  const label = `PDB ${workloadTarget(asString(parsed?.namespace), asString(parsed?.name))}`;
  return {
    run_id: run.id,
    label,
    detail:
      `Disruptions allowed ${asNumber(parsed?.disruptions_allowed) ?? 0}`
      + ` · healthy ${asNumber(parsed?.current_healthy) ?? "?"}/${asNumber(parsed?.desired_healthy) ?? "?"}`,
    target_name: targetName,
    created_at_label: run.created_at_label ?? run.created_at,
  };
}

function buildCapacityItem(
  run: RunSummary,
  targetName: string,
  finding: Finding
): DashboardOperationalWatchItem {
  const parsed = parseEvidenceJson(finding);
  if (finding.section_source === "quotas/resource-quotas.json") {
    const resource =
      parsed && typeof parsed.resource === "object" && !Array.isArray(parsed.resource)
        ? (parsed.resource as Record<string, unknown>)
        : null;
    return {
      run_id: run.id,
      label: `Quota ${workloadTarget(asString(parsed?.namespace), asString(parsed?.name))}`,
      detail:
        `${asString(resource?.resource) ?? "resource"} at `
        + `${asNumber(resource?.used_ratio) !== null ? `${(asNumber(resource?.used_ratio)! * 100).toFixed(1)}%` : "high usage"}`,
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  if (finding.section_source === "metrics/node-top.json") {
    const nodeName = asString(parsed?.name) ?? "unknown-node";
    if (finding.title.includes("memory usage is elevated")) {
      return {
        run_id: run.id,
        label: nodeName,
        detail: `${asNumber(parsed?.memory_percent)?.toFixed(1) ?? "?"}% memory used`,
        target_name: targetName,
        created_at_label: run.created_at_label ?? run.created_at,
      };
    }
    return {
      run_id: run.id,
      label: nodeName,
      detail: `${asNumber(parsed?.cpu_percent)?.toFixed(1) ?? "?"}% CPU used`,
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  const nodeName = asString(parsed?.name) ?? finding.title.replace("Kubernetes node is not Ready: ", "");
  return {
    run_id: run.id,
    label: nodeName,
    detail:
      finding.title.includes("pressure conditions")
        ? "Pressure conditions reported"
        : "Node is not Ready",
    target_name: targetName,
    created_at_label: run.created_at_label ?? run.created_at,
  };
}

function buildStorageItem(
  run: RunSummary,
  targetName: string,
  finding: Finding
): DashboardOperationalWatchItem {
  const parsed = parseEvidenceJson(finding);
  if (finding.section_source === "storage/persistent-volume-claims.json") {
    const label = `PVC ${workloadTarget(asString(parsed?.namespace), asString(parsed?.name))}`;
    if (finding.title.includes("filesystem resize")) {
      return {
        run_id: run.id,
        label,
        detail: "Filesystem resize pending",
        target_name: targetName,
        created_at_label: run.created_at_label ?? run.created_at,
      };
    }
    if (finding.title.includes("is Pending")) {
      return {
        run_id: run.id,
        label,
        detail:
          `Pending`
          + (asString(parsed?.requested_storage) ? ` · requested ${asString(parsed?.requested_storage)}` : "")
          + (asString(parsed?.storage_class_name) ? ` · class ${asString(parsed?.storage_class_name)}` : ""),
        target_name: targetName,
        created_at_label: run.created_at_label ?? run.created_at,
      };
    }
    return {
      run_id: run.id,
      label,
      detail: "Claim is lost",
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  if (finding.section_source === "storage/persistent-volumes.json") {
    return {
      run_id: run.id,
      label: `PV ${asString(parsed?.name) ?? "unknown-volume"}`,
      detail:
        `${asString(parsed?.phase) ?? "Degraded"}`
        + (asString(parsed?.reclaim_policy) ? ` · reclaim ${asString(parsed?.reclaim_policy)}` : ""),
      target_name: targetName,
      created_at_label: run.created_at_label ?? run.created_at,
    };
  }

  const workload =
    parsed && typeof parsed.workload === "object" && !Array.isArray(parsed.workload)
      ? (parsed.workload as Record<string, unknown>)
      : null;
  const claim =
    parsed && typeof parsed.persistent_volume_claim === "object" && !Array.isArray(parsed.persistent_volume_claim)
      ? (parsed.persistent_volume_claim as Record<string, unknown>)
      : null;
  return {
    run_id: run.id,
    label: workloadTarget(asString(workload?.namespace), asString(workload?.name)),
    detail: finding.title.includes("filesystem resize")
      ? `Waiting on PVC resize ${workloadTarget(asString(claim?.namespace), asString(claim?.name))}`
      : `Blocked on pending PVC ${workloadTarget(asString(claim?.namespace), asString(claim?.name))}`,
    target_name: targetName,
    created_at_label: run.created_at_label ?? run.created_at,
  };
}

function buildItemForLane(
  laneId: DashboardOperationalWatchLaneId,
  run: RunSummary,
  targetName: string,
  finding: Finding
): DashboardOperationalWatchItem {
  if (laneId === "failure") return buildFailureItem(run, targetName, finding);
  if (laneId === "rollout") return buildRolloutItem(run, targetName, finding);
  if (laneId === "capacity") return buildCapacityItem(run, targetName, finding);
  return buildStorageItem(run, targetName, finding);
}

export function buildDashboardOperationalWatch(
  snapshots: DashboardOperationalWatchRun[]
): DashboardOperationalWatchLane[] {
  const lanes = new Map<DashboardOperationalWatchLaneId, LaneState>([
    [
      "failure",
      {
        id: "failure",
        title: "Failure Excerpts",
        summary: "Captured bounded failure lines from unhealthy containers or pods so the immediate breakage is visible at fleet level.",
        tone: "critical",
        run_count: 0,
        items: [],
        seen_runs: new Set<string>(),
      },
    ],
    [
      "rollout",
      {
        id: "rollout",
        title: "Rollout Trouble",
        summary: "Replica lag, saturated autoscaling, and disruption controls that are actively slowing or blocking recovery.",
        tone: "warning",
        run_count: 0,
        items: [],
        seen_runs: new Set<string>(),
      },
    ],
    [
      "capacity",
      {
        id: "capacity",
        title: "Capacity Pressure",
        summary: "Node pressure and quota saturation signals that usually explain instability before workload tuning starts.",
        tone: "warning",
        run_count: 0,
        items: [],
        seen_runs: new Set<string>(),
      },
    ],
    [
      "storage",
      {
        id: "storage",
        title: "Storage Pressure",
        summary: "Pending claims, resize waits, degraded volumes, and workloads blocked on storage dependencies.",
        tone: "warning",
        run_count: 0,
        items: [],
        seen_runs: new Set<string>(),
      },
    ],
  ]);

  for (const snapshot of snapshots) {
    for (const finding of snapshot.findings) {
      const laneId = classifyFindingLane(finding);
      if (!laneId) continue;
      const lane = lanes.get(laneId);
      if (!lane) continue;
      lane.seen_runs.add(snapshot.run.id);
      if (lane.items.length >= 4 || lane.items.some((item) => item.run_id === snapshot.run.id)) {
        continue;
      }
      lane.items.push(buildItemForLane(laneId, snapshot.run, snapshot.target_name, finding));
    }
  }

  return Array.from(lanes.values())
    .map(({ seen_runs, ...lane }) => ({
      ...lane,
      run_count: seen_runs.size,
    }))
    .filter((lane) => lane.run_count > 0);
}
