import type { Finding } from "@/lib/analyzer/schema";

export type RunEvidenceSection = {
  id: string;
  title: string;
  summary: string;
  tone: "critical" | "warning" | "neutral";
  entries: Array<{
    label: string;
    value: string;
    emphasis?: boolean;
  }>;
};

function parseFindingEvidenceJson(finding: Finding): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(finding.evidence) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
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

function buildContainerEvidence(findings: Finding[]): RunEvidenceSection[] {
  let runtimeState: string | null = null;
  let healthState: string | null = null;
  let restartCount: string | null = null;
  let oomKilled = false;
  let memoryPressure: string | null = null;
  let memoryLimit = false;

  for (const finding of findings) {
    if (finding.title.startsWith("Container runtime state is ")) {
      runtimeState = finding.evidence.trim() || finding.title.replace("Container runtime state is ", "");
    } else if (finding.title === "Container health check is failing") {
      healthState = finding.evidence.trim() || "unhealthy";
    } else if (finding.title.startsWith("Container restarted ")) {
      restartCount = finding.evidence.trim() || finding.title.replace("Container restarted ", "");
    } else if (finding.title === "Container was OOM-killed") {
      oomKilled = true;
    } else if (finding.title.startsWith("Container memory usage is elevated")) {
      const match = finding.title.match(/\(([^)]+)\)/);
      memoryPressure = match?.[1] ?? finding.evidence.trim() ?? null;
    } else if (finding.title === "Container has no memory limit configured") {
      memoryLimit = true;
    }
  }

  if (
    !runtimeState &&
    !healthState &&
    !restartCount &&
    !oomKilled &&
    !memoryPressure &&
    !memoryLimit
  ) {
    return [];
  }

  return [
    {
      id: "container-runtime-health",
      title: "Runtime Health",
      summary: "Current container state, restart history, and memory headroom captured from the submitted diagnostics artifact.",
      tone:
        oomKilled || healthState === "unhealthy" || runtimeState === "restarting"
          ? "critical"
          : memoryPressure || restartCount
            ? "warning"
            : "neutral",
      entries: [
        { label: "Runtime state", value: runtimeState ?? "running", emphasis: runtimeState != null },
        { label: "Health", value: healthState ?? "healthy", emphasis: healthState != null },
        { label: "Restarts", value: restartCount ?? "0", emphasis: restartCount != null },
        { label: "OOM killed", value: oomKilled ? "Yes" : "No", emphasis: oomKilled },
        {
          label: "Memory guardrail",
          value: memoryPressure ?? (memoryLimit ? "No limit configured" : "No elevated pressure captured"),
          emphasis: memoryPressure != null || memoryLimit,
        },
      ],
    },
  ];
}

function buildKubernetesEvidence(findings: Finding[]): RunEvidenceSection[] {
  const rolloutEntries: RunEvidenceSection["entries"] = [];
  const pressureEntries: RunEvidenceSection["entries"] = [];
  const warningEntries: RunEvidenceSection["entries"] = [];
  const guardrailEntries: RunEvidenceSection["entries"] = [];
  const rolloutSeen = new Set<string>();
  const pressureSeen = new Set<string>();
  const warningSeen = new Set<string>();
  const guardrailSeen = new Set<string>();

  for (const finding of findings) {
    if (finding.section_source === "workloads/rollout-status.json") {
      const parsed = parseFindingEvidenceJson(finding);
      const workloadKind = asString(parsed?.kind) ?? "Workload";
      const workloadName =
        [asString(parsed?.namespace), asString(parsed?.name)].filter(Boolean).join("/") || "unknown-workload";

      if (finding.title.startsWith("Kubernetes rollout controller has not observed the latest spec generation:")) {
        const value = `Observed generation ${asNumber(parsed?.observed_generation) ?? "?"} of ${asNumber(parsed?.generation) ?? "?"}`;
        const key = `${workloadKind}:${workloadName}:controller-lag:${value}`;
        if (!rolloutSeen.has(key)) {
          rolloutEntries.push({
            label: `${workloadKind} ${workloadName}`,
            value,
            emphasis: true,
          });
          rolloutSeen.add(key);
        }
      }

      if (finding.title.startsWith("Kubernetes rollout incomplete:")) {
        const value =
          `Ready ${asNumber(parsed?.ready_replicas) ?? "?"}/${asNumber(parsed?.desired_replicas) ?? "?"}, ` +
          `updated ${asNumber(parsed?.updated_replicas) ?? "?"}, unavailable ${asNumber(parsed?.unavailable_replicas) ?? "?"}`;
        const key = `${workloadKind}:${workloadName}:rollout:${value}`;
        if (!rolloutSeen.has(key)) {
          rolloutEntries.push({
            label: `${workloadKind} ${workloadName}`,
            value,
            emphasis: true,
          });
          rolloutSeen.add(key);
        }
      }
      continue;
    }

    if (finding.section_source === "autoscaling/horizontal-pod-autoscalers.json") {
      const parsed = parseFindingEvidenceJson(finding);
      const hpaLabel =
        [asString(parsed?.namespace), asString(parsed?.name)].filter(Boolean).join("/") ||
        "unknown-hpa";

      if (finding.title.startsWith("Kubernetes HPA is saturated at max replicas:")) {
        const value =
          `Desired ${asNumber(parsed?.desired_replicas) ?? "?"}/${asNumber(parsed?.max_replicas) ?? "?"}`
          + (
            asNumber(parsed?.current_cpu_utilization_percentage) !== null &&
            asNumber(parsed?.target_cpu_utilization_percentage) !== null
              ? ` · CPU ${asNumber(parsed?.current_cpu_utilization_percentage)}% vs target ${asNumber(parsed?.target_cpu_utilization_percentage)}%`
              : ""
          );
        const key = `hpa-saturated:${hpaLabel}:${value}`;
        if (!rolloutSeen.has(key)) {
          rolloutEntries.push({
            label: `HPA ${hpaLabel}`,
            value,
            emphasis: true,
          });
          rolloutSeen.add(key);
        }
      } else if (
        finding.title.startsWith("Kubernetes HPA cannot compute a healthy scaling recommendation:")
      ) {
        const blockedCondition = Array.isArray(parsed?.conditions)
          ? (parsed?.conditions as Array<Record<string, unknown>>).find(
              (condition) =>
                (asString(condition.type) === "ScalingActive" ||
                  asString(condition.type) === "AbleToScale") &&
                asString(condition.status) !== "True"
            )
          : null;
        const value =
          asString(blockedCondition?.reason) ??
          asString(blockedCondition?.message) ??
          "Scaling recommendation unavailable";
        const key = `hpa-blocked:${hpaLabel}:${value}`;
        if (!rolloutSeen.has(key)) {
          rolloutEntries.push({
            label: `HPA ${hpaLabel}`,
            value,
            emphasis: true,
          });
          rolloutSeen.add(key);
        }
      }
      continue;
    }

    if (finding.section_source === "policy/pod-disruption-budgets.json") {
      const parsed = parseFindingEvidenceJson(finding);
      const label =
        [asString(parsed?.namespace), asString(parsed?.name)].filter(Boolean).join("/") ||
        "unknown-pdb";
      const value =
        `Disruptions allowed ${asNumber(parsed?.disruptions_allowed) ?? 0}, ` +
        `healthy ${asNumber(parsed?.current_healthy) ?? "?"}/${asNumber(parsed?.desired_healthy) ?? "?"}`;
      const key = `pdb:${label}:${value}`;
      if (!rolloutSeen.has(key)) {
        rolloutEntries.push({
          label: `PDB ${label}`,
          value,
          emphasis: true,
        });
        rolloutSeen.add(key);
      }
      continue;
    }

    if (finding.section_source === "cluster/node-health.json" || finding.section_source === "metrics/node-top.json") {
      const parsed = parseFindingEvidenceJson(finding);
      if (finding.title.startsWith("Kubernetes node memory usage is elevated:")) {
        const value = `${asNumber(parsed?.memory_percent)?.toFixed(1) ?? "?"}% memory used`;
        const key = `memory:${asString(parsed?.name) ?? "unknown-node"}:${value}`;
        if (!pressureSeen.has(key)) {
          pressureEntries.push({
            label: asString(parsed?.name) ?? "unknown-node",
            value,
            emphasis: true,
          });
          pressureSeen.add(key);
        }
      } else if (finding.title.startsWith("Kubernetes node CPU usage is elevated:")) {
        const value = `${asNumber(parsed?.cpu_percent)?.toFixed(1) ?? "?"}% CPU used`;
        const key = `cpu:${asString(parsed?.name) ?? "unknown-node"}:${value}`;
        if (!pressureSeen.has(key)) {
          pressureEntries.push({
            label: asString(parsed?.name) ?? "unknown-node",
            value,
            emphasis: true,
          });
          pressureSeen.add(key);
        }
      } else if (finding.title.startsWith("Kubernetes node is not Ready:")) {
        const value = "Node is not Ready";
        const label = finding.title.replace("Kubernetes node is not Ready: ", "");
        const key = `ready:${label}`;
        if (!pressureSeen.has(key)) {
          pressureEntries.push({
            label,
            value,
            emphasis: true,
          });
          pressureSeen.add(key);
        }
      } else if (finding.title.startsWith("Kubernetes node reports pressure conditions:")) {
        const label = finding.title.replace("Kubernetes node reports pressure conditions: ", "");
        const key = `conditions:${label}`;
        if (!pressureSeen.has(key)) {
          pressureEntries.push({
            label,
            value: "Pressure conditions reported",
            emphasis: true,
          });
          pressureSeen.add(key);
        }
      }
      continue;
    }

    if (finding.section_source === "quotas/resource-quotas.json") {
      const parsed = parseFindingEvidenceJson(finding);
      const quotaResource =
        parsed && typeof parsed.resource === "object" && !Array.isArray(parsed.resource)
          ? (parsed.resource as Record<string, unknown>)
          : null;
      const label =
        [asString(parsed?.namespace), asString(parsed?.name)].filter(Boolean).join("/") ||
        "unknown-quota";
      const ratio = asNumber(quotaResource?.used_ratio);
      const value =
        `${asString(quotaResource?.resource) ?? "resource"} at ${
          ratio !== null ? `${(ratio * 100).toFixed(1)}%` : "high usage"
        }`;
      const key = `quota:${label}:${value}`;
      if (!pressureSeen.has(key)) {
        pressureEntries.push({
          label: `Quota ${label}`,
          value,
          emphasis: true,
        });
        pressureSeen.add(key);
      }
      continue;
    }

    if (finding.section_source === "quotas/limit-ranges.json") {
      const parsed = parseFindingEvidenceJson(finding);
      const label = asString(parsed?.namespace) ?? "unknown-namespace";
      const value = asString(parsed?.missing) ?? "Missing default requests or limits";
      const key = `limit-range:${label}:${value}`;
      if (!guardrailSeen.has(key)) {
        guardrailEntries.push({
          label,
          value,
          emphasis: true,
        });
        guardrailSeen.add(key);
      }
      continue;
    }

    if (finding.section_source === "events/warning-events.json") {
      const parsed = parseFindingEvidenceJson(finding);
      const namespaces = asStringArray(parsed?.namespaces);
      const affectedObjects = asStringArray(parsed?.affected_objects);
      const total = asNumber(parsed?.warning_event_count);
      const label = finding.title.replace(/\s*\(\d+ events\)$/, "");
      const value =
        `${total ?? "?"} events across ${formatList(namespaces.length > 0 ? namespaces : ["unknown namespace"])}`
        + (affectedObjects.length > 0 ? ` · ${formatList(affectedObjects)}` : "");
      const key = `${label}:${value}`;
      if (!warningSeen.has(key)) {
        warningEntries.push({
          label,
          value,
          emphasis: true,
        });
        warningSeen.add(key);
      }
    }
  }

  const sections: RunEvidenceSection[] = [];
  if (rolloutEntries.length > 0) {
    sections.push({
      id: "kubernetes-rollout",
      title: "Rollout Status",
      summary:
        rolloutEntries.length === 1
          ? "Controller reconciliation and replica availability for the affected workload."
          : `Controller reconciliation and replica availability issues across ${rolloutEntries.length} workload signals.`,
      tone: rolloutEntries.length > 1 ? "critical" : "warning",
      entries: rolloutEntries,
    });
  }
  if (pressureEntries.length > 0) {
    sections.push({
      id: "kubernetes-pressure",
      title: "Node Pressure",
      summary:
        pressureEntries.length === 1
          ? "Cluster-side pressure or node utilization captured during evidence collection."
          : `Cluster-side pressure signals captured across ${pressureEntries.length} node checks.`,
      tone: "warning",
      entries: pressureEntries,
    });
  }
  if (warningEntries.length > 0) {
    sections.push({
      id: "kubernetes-warnings",
      title: "Operational Warnings",
      summary:
        warningEntries.length === 1
          ? "Normalized warning events grouped from the bundle so operators can see why the workload is degraded."
          : `Normalized warning-event groups captured across ${warningEntries.length} operational failure modes.`,
      tone: "warning",
      entries: warningEntries,
    });
  }
  if (guardrailEntries.length > 0) {
    sections.push({
      id: "kubernetes-guardrails",
      title: "Namespace Guardrails",
      summary:
        guardrailEntries.length === 1
          ? "Namespace-level defaults or guardrails that are missing for the affected workload space."
          : `Namespace-level defaults or guardrails missing across ${guardrailEntries.length} workload scopes.`,
      tone: "neutral",
      entries: guardrailEntries,
    });
  }

  return sections;
}

export function buildRunEvidenceSections(
  artifactType: string,
  findings: Finding[]
): RunEvidenceSection[] {
  if (artifactType === "container-diagnostics") {
    return buildContainerEvidence(findings);
  }
  if (artifactType === "kubernetes-bundle") {
    return buildKubernetesEvidence(findings);
  }
  return [];
}
