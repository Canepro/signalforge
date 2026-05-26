import { parseContainerFloat, parseContainerInteger, parseContainerSections } from "@/lib/adapter/container-diagnostics/parse";
import {
  parseKubernetesBundle,
  parseKubernetesDocumentJson,
  type KubernetesBundleDocument,
  type KubernetesHorizontalPodAutoscaler,
  type KubernetesLimitRange,
  type KubernetesNodeHealth,
  type KubernetesNodeTop,
  type KubernetesPersistentVolumeClaim,
  type KubernetesPodDisruptionBudget,
  type KubernetesPodTop,
  type KubernetesResourceQuota,
  type KubernetesUnhealthyWorkloadLogExcerpt,
  type KubernetesWarningEvent,
  type KubernetesWorkloadRolloutStatus,
} from "@/lib/adapter/kubernetes-bundle/parse";
import { parseSections as parseLinuxSections } from "@/lib/adapter/linux-audit-log/sections";
import { classifyFindingSignal } from "@/lib/findings-presentation";
import type { Finding, Severity } from "@/lib/analyzer/schema";
import type {
  RunDetail,
  RunDetailSummaryBar,
  RunDetailSummaryCallout,
  RunDetailSummaryModule,
  RunDetailSummaryStat,
  RunDetailSummaryTone,
} from "@/types/api";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function severityCount(run: RunDetail, key: string) {
  return run.severity_counts[key] ?? 0;
}

function summarizeSignalCount(findings: Finding[], signal: ReturnType<typeof classifyFindingSignal>) {
  return findings.filter((finding) => classifyFindingSignal(finding) === signal).length;
}


const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function calloutToneForSeverity(severity: Severity): RunDetailSummaryTone {
  if (severity === "critical" || severity === "high") return "critical";
  if (severity === "medium") return "warning";
  return "neutral";
}

function buildPriorityCallouts(run: RunDetail): RunDetailSummaryModule | null {
  const findings = run.report?.findings ?? [];
  if (findings.length === 0) return null;

  const callouts = [...findings]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 3)
    .map((finding) => ({
      title: finding.title,
      body: finding.recommended_action.trim() || finding.why_it_matters,
      tone: calloutToneForSeverity(finding.severity),
    }));

  const hasCritical = callouts.some((callout) => callout.tone === "critical");

  return {
    id: "priority-callouts",
    title: "Priority Callouts",
    summary:
      "Top evidence-backed conditions to inspect before the findings table, ordered by deterministic severity.",
    tone: hasCritical ? "critical" : "warning",
    prominence: "supporting",
    kind: "callout-list",
    callouts,
  };
}

function sharedSummaryModules(
  run: RunDetail,
  options?: { includeHealthSummary?: boolean }
): RunDetailSummaryModule[] {
  if (options?.includeHealthSummary === false) {
    return [];
  }
  const findings = run.report?.findings ?? [];
  const criticalHigh = severityCount(run, "critical") + severityCount(run, "high");
  const stabilityCount = summarizeSignalCount(findings, "stability");
  const identityCount = summarizeSignalCount(findings, "identity");
  const exposureCount = summarizeSignalCount(findings, "exposure");
  const summaryStats: RunDetailSummaryStat[] = [
    {
      label: "Critical + high",
      value: String(criticalHigh),
      detail: criticalHigh > 0 ? "Needs operator attention" : "No top-severity findings",
      tone: criticalHigh > 0 ? "critical" : "neutral",
    },
    {
      label: "Instability & pressure",
      value: String(stabilityCount),
      detail: "Operational signal count",
      tone: stabilityCount > 0 ? "warning" : "neutral",
    },
    {
      label: "Identity & access",
      value: String(identityCount),
      detail: "RBAC, tokens, service accounts, secrets",
      tone: identityCount > 0 ? "warning" : "neutral",
    },
    {
      label: "Exposure",
      value: String(exposureCount),
      detail: "Public reachability and listener posture",
      tone: exposureCount > 0 ? "warning" : "neutral",
    },
  ];

  const modules: RunDetailSummaryModule[] = [
    {
      id: "run-health-summary",
      title: "Run Health Summary",
      summary: "A compact operator view of severity and signal distribution before you drop into detailed findings.",
      tone: criticalHigh > 0 ? "critical" : stabilityCount > 0 ? "warning" : "neutral",
      prominence: "supporting",
      kind: "stat-grid",
      stats: summaryStats,
    },
  ];

  return modules;
}

function percentLabel(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "Not recorded";
}

function barTone(percent: number | null | undefined): RunDetailSummaryTone {
  if ((percent ?? 0) >= 90) return "critical";
  if ((percent ?? 0) >= 75) return "warning";
  return "neutral";
}

function moduleTone(condition: boolean, whenTrue: RunDetailSummaryTone, whenFalse: RunDetailSummaryTone): RunDetailSummaryTone {
  return condition ? whenTrue : whenFalse;
}

function parseCpuToMilli(cpu: string | null | undefined): number {
  const text = asString(cpu);
  if (!text) return 0;
  if (text.endsWith("m")) return Number.parseFloat(text.slice(0, -1)) || 0;
  return (Number.parseFloat(text) || 0) * 1000;
}

function describeKubernetesSchedulingPressure(
  schedulingWarnings: KubernetesWarningEvent[]
): { summary: string; detail: string } | null {
  if (schedulingWarnings.length === 0) return null;
  const message = (schedulingWarnings[0]?.message ?? "").trim();
  if (!message) {
    return {
      summary: "Scheduling pressure detected",
      detail: "FailedScheduling events indicate pods could not be placed on available nodes.",
    };
  }
  const insufficientCpu = /insufficient cpu/i.test(message);
  const insufficientMemory = /insufficient memory/i.test(message);
  const resourceParts: string[] = [];
  if (insufficientCpu) resourceParts.push("CPU");
  if (insufficientMemory) resourceParts.push("memory");
  const resourceHint =
    resourceParts.length > 0
      ? `insufficient ${resourceParts.join(" and ")} on schedulable nodes`
      : "insufficient schedulable capacity";
  return {
    summary: `Scheduling blocked (${resourceHint})`,
    detail: `FailedScheduling: ${message}`,
  };
}

function parseMemoryToMi(memory: string | null | undefined): number {
  const text = asString(memory);
  if (!text) return 0;
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti)?$/i);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "Mi").toLowerCase();
  if (unit === "ki") return value / 1024;
  if (unit === "mi") return value;
  if (unit === "gi") return value * 1024;
  if (unit === "ti") return value * 1024 * 1024;
  return value;
}

function parseHumanSizeToBytes(value: string | null | undefined): number | null {
  const text = asString(value);
  if (!text) return null;
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([KMGT]?i?B?|B)$/i);
  if (!match) return null;
  const count = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const factors: Record<string, number> = {
    b: 1,
    k: 1000,
    kb: 1000,
    ki: 1024,
    kib: 1024,
    m: 1000 ** 2,
    mb: 1000 ** 2,
    mi: 1024 ** 2,
    mib: 1024 ** 2,
    g: 1000 ** 3,
    gb: 1000 ** 3,
    gi: 1024 ** 3,
    gib: 1024 ** 3,
    t: 1000 ** 4,
    tb: 1000 ** 4,
    ti: 1024 ** 4,
    tib: 1024 ** 4,
  };
  return count * (factors[unit] ?? 1);
}

function formatBytesToGi(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Not recorded";
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

function buildKubernetesModules(run: RunDetail, artifactContent: string): RunDetailSummaryModule[] {
  const manifest = parseKubernetesBundle(artifactContent);
  if (!manifest) return [];
  const docsByPath = new Map(manifest.documents.map((doc) => [doc.path, doc] as const));
  const nodeTop =
    parseKubernetesDocumentJson<KubernetesNodeTop[]>(
      docsByPath.get("metrics/node-top.json") as KubernetesBundleDocument
    ) ?? [];
  const podTop =
    parseKubernetesDocumentJson<KubernetesPodTop[]>(
      docsByPath.get("metrics/pod-top.json") as KubernetesBundleDocument
    ) ?? [];
  const warningEvents =
    parseKubernetesDocumentJson<KubernetesWarningEvent[]>(
      docsByPath.get("events/warning-events.json") as KubernetesBundleDocument
    ) ?? [];
  const nodeHealth =
    parseKubernetesDocumentJson<KubernetesNodeHealth[]>(
      docsByPath.get("cluster/node-health.json") as KubernetesBundleDocument
    ) ?? [];
  const hpas =
    parseKubernetesDocumentJson<KubernetesHorizontalPodAutoscaler[]>(
      docsByPath.get("autoscaling/horizontal-pod-autoscalers.json") as KubernetesBundleDocument
    ) ?? [];
  const pdbs =
    parseKubernetesDocumentJson<KubernetesPodDisruptionBudget[]>(
      docsByPath.get("policy/pod-disruption-budgets.json") as KubernetesBundleDocument
    ) ?? [];
  const quotas =
    parseKubernetesDocumentJson<KubernetesResourceQuota[]>(
      docsByPath.get("quotas/resource-quotas.json") as KubernetesBundleDocument
    ) ?? [];
  const limitRanges =
    parseKubernetesDocumentJson<KubernetesLimitRange[]>(
      docsByPath.get("quotas/limit-ranges.json") as KubernetesBundleDocument
    ) ?? [];
  const rolloutStatuses =
    parseKubernetesDocumentJson<KubernetesWorkloadRolloutStatus[]>(
      docsByPath.get("workloads/rollout-status.json") as KubernetesBundleDocument
    ) ?? [];
  const unhealthyLogs =
    parseKubernetesDocumentJson<KubernetesUnhealthyWorkloadLogExcerpt[]>(
      docsByPath.get("logs/unhealthy-workload-excerpts.json") as KubernetesBundleDocument
    ) ?? [];
  const claims =
    parseKubernetesDocumentJson<KubernetesPersistentVolumeClaim[]>(
      docsByPath.get("storage/persistent-volume-claims.json") as KubernetesBundleDocument
    ) ?? [];

  const schedulingWarnings = warningEvents.filter((event) => event.reason === "FailedScheduling");
  const schedulingWarningCount = schedulingWarnings.reduce(
    (sum, event) => sum + (event.count ?? 1),
    0
  );
  const schedulingPressure = describeKubernetesSchedulingPressure(schedulingWarnings);
  const peakMemory = nodeTop.reduce((max, node) => Math.max(max, node.memory_percent ?? 0), 0);
  const peakCpu = nodeTop.reduce((max, node) => Math.max(max, node.cpu_percent ?? 0), 0);
  const nodesWithPressureConditions = nodeHealth.filter(
    (node) => (node.pressure_conditions ?? []).length > 0 || node.ready === false
  ).length;
  const capacityStats: RunDetailSummaryStat[] = [
    {
      label: "Scope",
      value:
        manifest.scope.level === "namespace"
          ? `Namespace ${manifest.scope.namespace ?? "unknown"}`
          : "Cluster",
      detail: manifest.cluster.name,
      tone: "neutral",
    },
    {
      label: "Peak memory",
      value: percentLabel(peakMemory),
      detail: peakMemory >= 80 ? "Low memory headroom" : "No node above 80%",
      tone: barTone(peakMemory),
    },
    {
      label: "Peak CPU",
      value: percentLabel(peakCpu),
      detail: peakCpu >= 80 ? "Low CPU headroom on busiest node" : "No node above 80%",
      tone: barTone(peakCpu),
    },
    ...(schedulingPressure
      ? [
          {
            label: "Scheduling pressure",
            value:
              schedulingWarningCount === 1 ? "1 event" : `${schedulingWarningCount} events`,
            detail: schedulingPressure.detail,
            tone: "critical" as const,
          },
        ]
      : []),
    {
      label: "Node pressure",
      value: String(nodesWithPressureConditions),
      detail: "Nodes with NotReady or pressure conditions",
      tone: nodesWithPressureConditions > 0 ? "critical" : "neutral",
    },
  ];

  const topNodesByMemory = [...nodeTop].sort(
    (a, b) => (b.memory_percent ?? 0) - (a.memory_percent ?? 0)
  );
  const topNodesByCpu = [...nodeTop].sort((a, b) => (b.cpu_percent ?? 0) - (a.cpu_percent ?? 0));

  const nodeMemoryBars: RunDetailSummaryBar[] = topNodesByMemory.slice(0, 3).map((node) => {
    const nodeName = asString(node.name) ?? "unknown-node";
    return {
      label: nodeName,
      value: node.memory_percent ?? 0,
      maxValue: 100,
      value_label: percentLabel(node.memory_percent),
      detail: `Memory ${asString(node.memory) ?? "Not recorded"} · CPU ${percentLabel(node.cpu_percent)}`,
      tone: barTone(node.memory_percent),
    };
  });

  const nodeCpuBars: RunDetailSummaryBar[] = topNodesByCpu.slice(0, 3).map((node) => {
    const nodeName = asString(node.name) ?? "unknown-node";
    return {
      label: nodeName,
      value: node.cpu_percent ?? 0,
      maxValue: 100,
      value_label: percentLabel(node.cpu_percent),
      detail: `CPU ${asString(node.cpu) ?? "Not recorded"} · Memory ${percentLabel(node.memory_percent)}`,
      tone: barTone(node.cpu_percent),
    };
  });

  const maxPodMemory = podTop.reduce((max, pod) => Math.max(max, parseMemoryToMi(pod.memory)), 0);
  const topPodMemory = [...podTop]
    .sort((a, b) => parseMemoryToMi(b.memory) - parseMemoryToMi(a.memory))
    .slice(0, 5)
    .map((pod) => ({
      label: `${pod.namespace ?? "default"}/${pod.name ?? "unknown-pod"}`,
      value: parseMemoryToMi(pod.memory),
      maxValue: maxPodMemory || 1,
      value_label: asString(pod.memory) ?? "Not recorded",
      detail: `CPU ${asString(pod.cpu) ?? "Not recorded"}`,
      tone: "warning" as const,
    }));

  const maxPodCpu = podTop.reduce((max, pod) => Math.max(max, parseCpuToMilli(pod.cpu)), 0);
  const topPodCpu = [...podTop]
    .sort((a, b) => parseCpuToMilli(b.cpu) - parseCpuToMilli(a.cpu))
    .slice(0, 5)
    .map((pod) => ({
      label: `${pod.namespace ?? "default"}/${pod.name ?? "unknown-pod"}`,
      value: parseCpuToMilli(pod.cpu),
      maxValue: maxPodCpu || 1,
      value_label: asString(pod.cpu) ?? "Not recorded",
      detail: `Memory ${asString(pod.memory) ?? "Not recorded"}`,
      tone: "warning" as const,
    }));

  const limitRangeCoveredNamespaces = limitRanges.filter(
    (item) => item.has_default_limits && item.has_default_requests
  ).length;
  const nearExhaustedQuotas = quotas.flatMap((quota) =>
    (quota.resources ?? []).filter((resource) => (resource.used_ratio ?? 0) >= 0.9)
  ).length;
  const blockedPdbs = pdbs.filter((pdb) => (pdb.disruptions_allowed ?? 0) === 0).length;
  const pendingClaims = claims.filter((claim) => claim.phase === "Pending").length;
  const guardrailStats: RunDetailSummaryStat[] = [
    {
      label: "HPAs",
      value: String(hpas.length),
      detail: hpas.length > 0 ? "Autoscaling objects present" : "No HPA objects captured",
      tone: hpas.length > 0 ? "neutral" : "warning",
    },
    {
      label: "Blocked PDBs",
      value: String(blockedPdbs),
      detail: "PDBs with zero allowed disruptions",
      tone: blockedPdbs > 0 ? "warning" : "neutral",
    },
    {
      label: "Quota pressure",
      value: String(nearExhaustedQuotas),
      detail: "Quota resources at or above 90%",
      tone: nearExhaustedQuotas > 0 ? "warning" : "neutral",
    },
    {
      label: "LimitRange coverage",
      value: `${limitRangeCoveredNamespaces}/${limitRanges.length || 0}`,
      detail: "Namespaces with default limits and requests",
      tone:
        limitRanges.length > 0 && limitRangeCoveredNamespaces === limitRanges.length
          ? "neutral"
          : "warning",
    },
  ];

  const categoryCounts = new Map<string, number>();
  for (const event of warningEvents) {
    const message = `${event.reason ?? ""} ${event.message ?? ""}`.toLowerCase();
    let category = event.reason ?? "Warning";
    if (message.includes("insufficient cpu") || message.includes("failedscheduling")) {
      category = "Scheduling pressure";
    } else if (message.includes("imagepull") || message.includes("errimagepull")) {
      category = "Image pull failure";
    } else if (message.includes("validation")) {
      category = "Validation failure";
    } else if (message.includes("oom") || message.includes("evict")) {
      category = "Eviction or OOM";
    }
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + (event.count ?? 1));
  }

  const instabilityCallouts: RunDetailSummaryCallout[] = [];
  for (const [category, count] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    if (category === "Scheduling pressure" && schedulingPressure) continue;
    instabilityCallouts.push({
      title: category,
      body: `${count} warning event${count === 1 ? "" : "s"} captured in the bundle.`,
      tone: category === "Scheduling pressure" ? "critical" : "warning",
    });
  }

  for (const rollout of rolloutStatuses) {
    const desired = rollout.desired_replicas ?? 0;
    const ready = rollout.ready_replicas ?? 0;
    const unavailable = rollout.unavailable_replicas ?? 0;
    if (desired > 0 && (ready < desired || unavailable > 0)) {
      instabilityCallouts.push({
        title: `${rollout.kind ?? "Workload"} ${rollout.namespace ?? "default"}/${rollout.name ?? "unknown"}`,
        body: `Ready ${ready}/${desired}, unavailable ${unavailable}, observed generation ${rollout.observed_generation ?? "?"} of ${rollout.generation ?? "?"}.`,
        tone: unavailable >= Math.ceil(desired / 2) ? "critical" : "warning",
      });
    }
  }

  for (const excerpt of unhealthyLogs.slice(0, 2)) {
    const firstLine = excerpt.excerpt_lines?.[0]?.trim();
    if (!firstLine) continue;
    instabilityCallouts.push({
      title: `${excerpt.workload_kind ?? "Workload"} ${excerpt.namespace ?? "default"}/${excerpt.workload_name ?? "unknown"}`,
      body: `${excerpt.reason ?? "Failure"} in ${excerpt.pod_name ?? "unknown-pod"}/${excerpt.container_name ?? "unknown-container"}: ${firstLine}`,
      tone: "warning",
    });
  }

  if (schedulingPressure) {
    instabilityCallouts.unshift({
      title: "Scheduling pressure",
      body: schedulingPressure.detail,
      tone: "critical",
    });
  }

  const modules: RunDetailSummaryModule[] = [
    {
      id: "kubernetes-capacity-snapshot",
      title: "Cluster Capacity Snapshot",
      summary: schedulingPressure
        ? "Node utilization and explicit FailedScheduling evidence from the bundle — read this before the findings table when pods cannot land."
        : "Quantitative node-capacity signals and scheduling headroom captured directly from the Kubernetes bundle.",
      tone:
        schedulingWarnings.length > 0 || peakMemory >= 90
          ? "critical"
          : peakMemory >= 75
            ? "warning"
            : "neutral",
      prominence: "primary",
      kind: "stat-grid",
      stats: capacityStats,
    },
    ...(nodeMemoryBars.length > 0
      ? [
          {
            id: "kubernetes-top-node-consumers",
            title: "Top Node Consumers",
            summary: "Highest node memory utilization captured by kubectl top — use this to see where cluster pressure is concentrated.",
            tone: moduleTone(peakMemory >= 75, "warning", "neutral"),
            prominence: "supporting" as const,
            kind: "bar-list" as const,
            bars: nodeMemoryBars,
          },
        ]
      : []),
    ...(nodeCpuBars.length > 0 && peakCpu >= 70
      ? [
          {
            id: "kubernetes-top-node-cpu",
            title: "Top Node CPU",
            summary: "Busiest nodes by CPU when utilization is high enough to affect scheduling headroom.",
            tone: moduleTone(peakCpu >= 85, "critical", "warning"),
            prominence: "supporting" as const,
            kind: "bar-list" as const,
            bars: nodeCpuBars,
          },
        ]
      : []),
    ...(topPodMemory.length > 0
      ? [
          {
            id: "kubernetes-top-pod-memory",
            title: "Top Pod Memory Consumers",
            summary: "Highest pod memory consumers from kubectl top during collection.",
            tone: "warning" as const,
            prominence: "supporting" as const,
            kind: "bar-list" as const,
            bars: topPodMemory,
          },
        ]
      : []),
    ...(topPodCpu.length > 0
      ? [
          {
            id: "kubernetes-top-pod-cpu",
            title: "Top Pod CPU Consumers",
            summary: "Highest pod CPU consumers from kubectl top during collection.",
            tone: "warning" as const,
            prominence: "supporting" as const,
            kind: "bar-list" as const,
            bars: topPodCpu,
          },
        ]
      : []),
    {
      id: "kubernetes-guardrails",
      title: "Cluster Guardrails",
      summary: "Autoscaling, disruption, quota, and namespace-default coverage that changes how operators should interpret capacity signals.",
      tone: moduleTone(blockedPdbs > 0 || nearExhaustedQuotas > 0 || pendingClaims > 0, "warning", "neutral"),
      prominence: "supporting" as const,
      kind: "stat-grid",
      stats: [
        ...guardrailStats,
        {
          label: "Pending claims",
          value: String(pendingClaims),
          detail: "PersistentVolumeClaims still pending",
          tone: pendingClaims > 0 ? "warning" : "neutral",
        },
      ],
    },
    ...(instabilityCallouts.length > 0
      ? [
          {
            id: "kubernetes-instability-callouts",
            title: "Workload Instability",
            summary: "Short, operator-oriented callouts for scheduling, rollout, and failing-workload evidence.",
            tone: moduleTone(instabilityCallouts.some((item) => item.tone === "critical"), "critical", "warning"),
            prominence: "supporting" as const,
            kind: "callout-list" as const,
            callouts: instabilityCallouts.slice(0, 6),
          },
        ]
      : []),
  ];

  return modules;
}

function buildContainerModules(_run: RunDetail, artifactContent: string): RunDetailSummaryModule[] {
  const sections = parseContainerSections(artifactContent);
  const runtimeState = asString(sections.state_status) ?? "running";
  const health = asString(sections.health_status) ?? "healthy";
  const restartCount = parseContainerInteger(sections.restart_count) ?? 0;
  const oomKilled = sections.oom_killed?.trim().toLowerCase() === "true";
  const pidCount = parseContainerInteger(sections.pid_count);
  const cpuPercent = parseContainerFloat(sections.cpu_percent);
  const memoryPercent = parseContainerFloat(sections.memory_percent);
  const memoryLimitBytes = parseContainerInteger(sections.memory_limit_bytes);
  const memoryReservationBytes = parseContainerInteger(sections.memory_reservation_bytes);

  const runtimeStats: RunDetailSummaryStat[] = [
    {
      label: "Runtime state",
      value: runtimeState,
      detail: asString(sections.runtime) ?? "Unknown runtime",
      tone: runtimeState === "running" ? "neutral" : "critical",
    },
    {
      label: "Health",
      value: health,
      detail: "Container-reported health status",
      tone: health === "healthy" ? "neutral" : "critical",
    },
    {
      label: "Restarts",
      value: String(restartCount),
      detail: "Restart count observed at collection time",
      tone: restartCount >= 3 ? "warning" : "neutral",
    },
    {
      label: "OOM killed",
      value: oomKilled ? "Yes" : "No",
      detail: pidCount !== null ? `${pidCount} processes in container` : null,
      tone: oomKilled ? "critical" : "neutral",
    },
  ];

  const resourceBars: RunDetailSummaryBar[] = [];
  if (cpuPercent !== null) {
    resourceBars.push({
      label: "CPU usage",
      value: cpuPercent,
      maxValue: 100,
      value_label: percentLabel(cpuPercent),
      detail: "One-shot runtime sample",
      tone: barTone(cpuPercent),
    });
  }
  if (memoryPercent !== null) {
    resourceBars.push({
      label: "Memory usage",
      value: memoryPercent,
      maxValue: 100,
      value_label: percentLabel(memoryPercent),
      detail: `Limit ${formatBytesToGi(memoryLimitBytes)}`,
      tone: barTone(memoryPercent),
    });
  }

  const resourceStats: RunDetailSummaryStat[] = [
    {
      label: "Memory limit",
      value:
        memoryLimitBytes === null
          ? "Not recorded"
          : memoryLimitBytes === 0
            ? "None"
            : formatBytesToGi(memoryLimitBytes),
      detail: "Configured memory limit",
      tone: memoryLimitBytes === 0 ? "warning" : "neutral",
    },
    {
      label: "Reservation",
      value:
        memoryReservationBytes === null
          ? "Not recorded"
          : memoryReservationBytes === 0
            ? "None"
            : formatBytesToGi(memoryReservationBytes),
      detail: "Configured memory reservation",
      tone: "neutral",
    },
    {
      label: "Runs as root",
      value: sections.ran_as_root?.trim().toLowerCase() === "true" ? "Yes" : "No",
      detail: "Identity at collection time",
      tone: sections.ran_as_root?.trim().toLowerCase() === "true" ? "warning" : "neutral",
    },
    {
      label: "Read-only rootfs",
      value: sections.read_only_rootfs?.trim().toLowerCase() === "true" ? "Yes" : "No",
      detail: "Filesystem hardening",
      tone: sections.read_only_rootfs?.trim().toLowerCase() === "true" ? "neutral" : "warning",
    },
  ];

  const callouts: RunDetailSummaryCallout[] = [];
  if (memoryPercent !== null && memoryPercent >= 90 && memoryLimitBytes === 0) {
    callouts.push({
      title: "Memory pressure without a limit",
      body: `Runtime memory usage is ${percentLabel(memoryPercent)} with no configured memory limit — OOM risk is elevated.`,
      tone: "critical",
    });
  } else if (memoryPercent !== null && memoryPercent >= 85 && memoryLimitBytes === null) {
    callouts.push({
      title: "High memory utilization",
      body: `One-shot sample shows ${percentLabel(memoryPercent)} memory usage, but the configured memory limit was not recorded.`,
      tone: "warning",
    });
  } else if (memoryPercent !== null && memoryPercent >= 85) {
    callouts.push({
      title: "High memory utilization",
      body: `One-shot sample shows ${percentLabel(memoryPercent)} of the configured limit in use.`,
      tone: "warning",
    });
  }

  const failureExcerptJson = sections.failure_log_excerpts_json;
  if (failureExcerptJson) {
    try {
      const excerpts = JSON.parse(failureExcerptJson) as Array<Record<string, unknown>>;
      for (const excerpt of excerpts.slice(0, 2)) {
        const lines = Array.isArray(excerpt.excerpt_lines)
          ? excerpt.excerpt_lines.filter(
              (line): line is string => typeof line === "string" && line.trim().length > 0
            )
          : [];
        if (lines.length === 0) continue;
        callouts.push({
          title: `${asString(excerpt.reason) ?? "Failure"} · ${asString(excerpt.source) ?? "current"} logs`,
          body: lines[0]!,
          tone: "warning",
        });
      }
    } catch {
      // ignore malformed excerpts
    }
  }

  const modules: RunDetailSummaryModule[] = [
    {
      id: "container-runtime-health",
      title: "Container Runtime Health",
      summary: "Runtime state, restart history, and memory safety signals from the submitted container diagnostics artifact.",
      tone:
        oomKilled || health !== "healthy" || runtimeState !== "running"
          ? "critical"
          : restartCount >= 3
            ? "warning"
            : "neutral",
      prominence: "primary",
      kind: "stat-grid",
      stats: runtimeStats,
    },
    {
      id: "container-guardrails",
      title: "Container Guardrails",
      summary: "Resource and hardening context that shapes how the runtime snapshot should be interpreted.",
      tone: moduleTone(resourceStats.some((stat) => stat.tone === "warning"), "warning", "neutral"),
      prominence: "supporting" as const,
      kind: "stat-grid",
      stats: resourceStats,
    },
  ];

  if (resourceBars.length > 0) {
    modules.push({
      id: "container-resource-snapshot",
      title: "Container Resource Snapshot",
      summary: "Compact one-shot CPU and memory bars so the operator can judge runtime pressure without reading raw numbers.",
      tone:
        resourceBars.some((bar) => bar.tone === "critical")
          ? "critical"
          : resourceBars.some((bar) => bar.tone === "warning")
            ? "warning"
            : "neutral",
      prominence: "supporting",
      kind: "bar-list",
      bars: resourceBars,
    });
  }

  if (callouts.length > 0) {
    modules.push({
      id: "container-failure-callouts",
      title: "Failure Callouts",
      summary: "Short bounded log evidence so the immediate failure mode is visible without expanding the findings table.",
      tone: moduleTone(
        callouts.some((callout) => callout.tone === "critical"),
        "critical",
        "warning"
      ),
      prominence: "supporting",
      kind: "callout-list",
      callouts,
    });
  }

  return modules;
}

function extractLinuxDiskUsage(sections: Record<string, string>) {
  const block = sections["DISK & MEMORY USAGE"] ?? "";
  return block
    .split("\n")
    .filter((line) => line.trim() && /(\d+)%/.test(line))
    .filter((line) => line.trim().startsWith("/") || line.trim().match(/^[A-Z]:\\/))
    .filter((line) => !line.includes("snapfuse") && !line.includes("/snap/"))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const usageMatch = line.match(/(\d+)%/);
      return {
        filesystem: parts[0] ?? "unknown",
        mount: parts[parts.length - 1] ?? "unknown",
        usagePercent: usageMatch ? Number.parseInt(usageMatch[1]!, 10) : 0,
        raw: line.trim(),
      };
    })
    .sort((a, b) => b.usagePercent - a.usagePercent);
}

function extractLinuxMemoryUsage(sections: Record<string, string>) {
  const block = sections["DISK & MEMORY USAGE"] ?? "";
  const memLine = block.split("\n").find((line) => line.trim().startsWith("Mem:"));
  const swapLine = block.split("\n").find((line) => line.trim().startsWith("Swap:"));
  const memParts = memLine?.trim().split(/\s+/) ?? [];
  const swapParts = swapLine?.trim().split(/\s+/) ?? [];
  const total = parseHumanSizeToBytes(memParts[1] ?? null);
  const used = parseHumanSizeToBytes(memParts[2] ?? null);
  const swapTotal = parseHumanSizeToBytes(swapParts[1] ?? null);
  const swapUsed = parseHumanSizeToBytes(swapParts[2] ?? null);
  return {
    total,
    used,
    percent:
      total && used
        ? Math.round((used / total) * 1000) / 10
        : null,
    swapPercent:
      swapTotal && swapUsed
        ? Math.round((swapUsed / swapTotal) * 1000) / 10
        : null,
  };
}

function extractPendingUpgradeCount(sections: Record<string, string>): number {
  const packages = sections["INSTALLED PACKAGES"] ?? "";
  const match = packages.match(/(\d+)\s+packages?\s+can\s+be\s+upgraded/i);
  if (match) return Number.parseInt(match[1]!, 10);
  return packages
    .split("\n")
    .filter((line) => line.includes("upgradable from") || (line.includes("upgradable") && !line.includes("Listing")))
    .length;
}

function extractRecentErrorCount(sections: Record<string, string>): number {
  const errors = sections["RECENT ERRORS & LOGS"] ?? "";
  return errors
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("→") && !line.startsWith("[")) // rough but stable for collector format
    .length;
}

function extractLoadAverage(sections: Record<string, string>): string | null {
  const system = sections["SYSTEM IDENTITY"] ?? "";
  const match = system.match(/load average:\s*([0-9.]+,\s*[0-9.]+,\s*[0-9.]+)/i);
  return match?.[1] ?? null;
}

interface LinuxProcessSample {
  user: string;
  pid: number;
  cpuPercent: number;
  memPercent: number;
  command: string;
}

function extractLinuxTopProcesses(sections: Record<string, string>): LinuxProcessSample[] {
  const servicesBlock = sections["RUNNING SERVICES"] ?? "";
  const markerIndex = servicesBlock.search(/Running Processes/i);
  const block = markerIndex >= 0 ? servicesBlock.slice(markerIndex) : servicesBlock;
  const lines = block.split("\n");
  const headerIndex = lines.findIndex((line) => /USER\s+PID\s+%CPU\s+%MEM/.test(line));
  if (headerIndex < 0) return [];

  const rows: LinuxProcessSample[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const rawLine = lines[i]?.trim() ?? "";
    if (!rawLine) continue;
    if (rawLine.includes("→") || rawLine.startsWith("[")) break;
    const parts = rawLine.split(/\s+/);
    if (parts.length < 11) continue;
    const user = parts[0]!;
    const pid = Number.parseInt(parts[1]!, 10);
    const cpuPercent = Number.parseFloat(parts[2]!);
    const memPercent = Number.parseFloat(parts[3]!);
    if (!Number.isFinite(pid) || !Number.isFinite(memPercent)) continue;
    rows.push({
      user,
      pid,
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
      memPercent,
      command: parts.slice(10).join(" "),
    });
  }

  return rows;
}

function shortenCommand(command: string, maxLength = 72): string {
  if (command.length <= maxLength) return command;
  return `${command.slice(0, maxLength - 1)}…`;
}

function buildLinuxModules(run: RunDetail, artifactContent: string): RunDetailSummaryModule[] {
  const sections = parseLinuxSections(artifactContent);
  const diskUsage = extractLinuxDiskUsage(sections);
  const memory = extractLinuxMemoryUsage(sections);
  const pendingUpgrades = extractPendingUpgradeCount(sections);
  const recentErrors = extractRecentErrorCount(sections);
  const loadAverage = extractLoadAverage(sections);
  const topProcesses = extractLinuxTopProcesses(sections);
  const peakDisk = diskUsage[0]?.usagePercent ?? 0;

  const stats: RunDetailSummaryStat[] = [
    {
      label: "Peak disk use",
      value: peakDisk ? `${peakDisk}%` : "Not recorded",
      detail: diskUsage[0] ? `${diskUsage[0].filesystem} mounted on ${diskUsage[0].mount}` : "No filesystem usage parsed",
      tone: peakDisk >= 90 ? "critical" : peakDisk >= 85 ? "warning" : "neutral",
    },
    {
      label: "Memory use",
      value: memory.percent !== null ? `${memory.percent.toFixed(1)}%` : "Not recorded",
      detail:
        memory.used !== null && memory.total !== null
          ? `${formatBytesToGi(memory.used)} of ${formatBytesToGi(memory.total)}`
          : "Memory summary unavailable",
      tone: barTone(memory.percent),
    },
    {
      label: "Pending upgrades",
      value: String(pendingUpgrades),
      detail: pendingUpgrades > 0 ? "Packages available for update" : "No pending package upgrades captured",
      tone: pendingUpgrades > 0 ? "warning" : "neutral",
    },
    {
      label: "Recent errors",
      value: String(recentErrors),
      detail: loadAverage ? `Load average ${loadAverage}` : "Recent syslog, journal, or auth errors",
      tone: recentErrors > 0 ? "warning" : "neutral",
    },
  ];

  const diskBars: RunDetailSummaryBar[] = diskUsage.slice(0, 5).map((entry) => ({
    label: `${entry.filesystem} (${entry.mount})`,
    value: entry.usagePercent,
    maxValue: 100,
    value_label: `${entry.usagePercent}%`,
    detail: entry.raw,
    tone: barTone(entry.usagePercent),
  }));

  const callouts: RunDetailSummaryCallout[] = [];
  for (const finding of (run.report?.findings ?? []).slice(0, 20)) {
    if (
      finding.title.includes("Disk usage") ||
      finding.title.includes("packages pending upgrade") ||
      finding.category === "logs"
    ) {
      callouts.push({
        title: finding.title,
        body: finding.why_it_matters,
        tone: moduleTone(
          finding.severity === "high" || finding.severity === "critical",
          "critical",
          "warning"
        ),
      });
    }
    if (callouts.length >= 4) break;
  }

  const modules: RunDetailSummaryModule[] = [
    {
      id: "host-pressure-snapshot",
      title: "Host Pressure Snapshot",
      summary: "Disk, memory, package, and recent-error signals extracted from the host audit so operators can assess system pressure before reading detailed findings.",
      tone:
        peakDisk >= 90
          ? "critical"
          : peakDisk >= 85 || pendingUpgrades > 0 || recentErrors > 0
            ? "warning"
            : "neutral",
      prominence: "primary",
      kind: "stat-grid",
      stats,
    },
  ];

  if (diskBars.length > 0) {
    modules.push({
      id: "host-storage-watch",
      title: "Host Storage Watch",
      summary: "The busiest filesystems captured in the audit, shown as compact usage bars rather than buried line items.",
      tone: moduleTone(peakDisk >= 85, "warning", "neutral"),
      prominence: "supporting",
      kind: "bar-list",
      bars: diskBars,
    });
  }

  const topByMemory = [...topProcesses].sort((a, b) => b.memPercent - a.memPercent).slice(0, 5);
  const topByCpu = [...topProcesses].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5);
  const maxMemPercent = topByMemory[0]?.memPercent ?? 0;
  const maxCpuPercent = topByCpu[0]?.cpuPercent ?? 0;

  if (topByMemory.length > 0) {
    modules.push({
      id: "host-top-processes",
      title: "Top Processes",
      summary: "Highest memory and CPU consumers from the captured ps snapshot — only shown when the audit includes a process listing.",
      tone: moduleTone(maxMemPercent >= 50 || maxCpuPercent >= 50, "warning", "neutral"),
      prominence: "supporting",
      kind: "bar-list",
      bars: [
        ...topByMemory.slice(0, 3).map((process) => ({
          label: `${process.user} · pid ${process.pid}`,
          value: process.memPercent,
          maxValue: maxMemPercent || 1,
          value_label: `${process.memPercent.toFixed(1)}% mem`,
          detail: shortenCommand(process.command),
          tone: barTone(process.memPercent) as RunDetailSummaryTone,
        })),
        ...topByCpu
          .filter((process) => !topByMemory.slice(0, 3).some((top) => top.pid === process.pid))
          .slice(0, 2)
          .map((process) => ({
            label: `${process.user} · pid ${process.pid}`,
            value: process.cpuPercent,
            maxValue: maxCpuPercent || 1,
            value_label: `${process.cpuPercent.toFixed(1)}% cpu`,
            detail: shortenCommand(process.command),
            tone: barTone(process.cpuPercent) as RunDetailSummaryTone,
          })),
      ],
    });
  }

  if (callouts.length > 0) {
    modules.push({
      id: "host-pressure-callouts",
      title: "Host Attention Points",
      summary: "Short callouts for the host-side items most likely to change operator decisions right away.",
      tone: moduleTone(callouts.some((item) => item.tone === "critical"), "critical", "warning"),
      prominence: "supporting",
      kind: "callout-list",
      callouts,
    });
  }

  return modules;
}

export function buildRunDetailSummaryModules(
  run: RunDetail,
  artifactContent: string | null | undefined
): RunDetailSummaryModule[] {
  const modules: RunDetailSummaryModule[] = [];
  const hasArtifactBytes = Boolean(artifactContent?.trim());

  if (hasArtifactBytes && run.artifact_type === "kubernetes-bundle") {
    modules.push(...buildKubernetesModules(run, artifactContent!));
  } else if (hasArtifactBytes && run.artifact_type === "container-diagnostics") {
    modules.push(...buildContainerModules(run, artifactContent!));
  } else if (hasArtifactBytes && run.artifact_type === "linux-audit-log") {
    modules.push(...buildLinuxModules(run, artifactContent!));
  }

  const hasFamilyPrimary = modules.some((module) => module.prominence === "primary");

  const priorityCallouts = buildPriorityCallouts(run);
  if (priorityCallouts) {
    modules.push(priorityCallouts);
  }

  modules.push(...sharedSummaryModules(run, { includeHealthSummary: !hasFamilyPrimary }));

  if (!modules.some((module) => module.prominence === "primary") && modules[0]) {
    modules[0] = { ...modules[0], prominence: "primary" };
  }

  return modules;
}
