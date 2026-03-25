import type { Severity } from "@/lib/analyzer/schema";
import { parseEnvironmentHostname, type RunWithArtifactRow } from "@/lib/db/repository";
import {
  parseContainerList,
  parseContainerSections,
} from "@/lib/adapter/container-diagnostics/parse";
import {
  parseKubernetesBundle,
  parseKubernetesDocumentJson,
  type KubernetesBundleDocument,
} from "@/lib/adapter/kubernetes-bundle/parse";

export type EvidenceDeltaStatus = "changed" | "unchanged" | "added" | "removed";

export interface EvidenceDeltaMetricRow {
  key: string;
  label: string;
  family: "common" | "linux-audit-log" | "container-diagnostics" | "kubernetes-bundle";
  status: EvidenceDeltaStatus;
  previous: string | number | boolean | null;
  current: string | number | boolean | null;
  unit: string | null;
}

export interface EvidenceDeltaPayload {
  changed: boolean;
  summary: {
    metadata_changed: number;
    metric_changes: number;
    artifact_changed: boolean;
  };
  metadata: {
    filename: EvidenceDeltaStatus;
    target_identifier: EvidenceDeltaStatus;
    collected_at: EvidenceDeltaStatus;
    collector_type: EvidenceDeltaStatus;
    collector_version: EvidenceDeltaStatus;
  };
  metrics: EvidenceDeltaMetricRow[];
}

type ContainerEvidenceSummary = {
  published_port_count: number;
  mount_count: number;
  writable_mount_count: number;
  added_capability_count: number;
  secret_mount_count: number;
  runs_as_root: boolean;
  read_only_rootfs: boolean;
};

type KubernetesServiceExposure = {
  namespace?: string;
  type?: string;
  external?: boolean;
};

type KubernetesRbacBinding = {
  roleRef?: string;
};

type KubernetesRbacRule = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
};

type KubernetesRbacRole = {
  rules?: KubernetesRbacRule[];
};

type KubernetesNetworkPolicy = {
  namespace?: string;
};

type KubernetesSecurityContext = {
  privileged?: boolean;
  allowPrivilegeEscalation?: boolean;
  runAsNonRoot?: boolean;
  readOnlyRootFilesystem?: boolean;
  seccompProfile?: {
    type?: string;
  } | null;
};

type KubernetesEnvVar = {
  valueFrom?: {
    secretKeyRef?: {
      name?: string;
      key?: string;
    } | null;
  } | null;
};

type KubernetesEnvFromSource = {
  secretRef?: {
    name?: string;
  } | null;
};

type KubernetesContainerSpec = {
  env?: KubernetesEnvVar[];
  envFrom?: KubernetesEnvFromSource[];
  securityContext?: KubernetesSecurityContext;
  readinessProbe?: unknown;
  livenessProbe?: unknown;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
};

type KubernetesPodSpec = {
  automountServiceAccountToken?: boolean;
  serviceAccountName?: string;
  securityContext?: KubernetesSecurityContext;
  containers?: KubernetesContainerSpec[];
};

type KubernetesWorkloadSpec = {
  pod_spec?: KubernetesPodSpec;
};

type KubernetesEvidenceSummary = {
  document_count: number;
  external_service_count: number;
  cluster_admin_binding_count: number;
  rbac_wildcard_role_count: number;
  rbac_privilege_escalation_role_count: number;
  rbac_node_proxy_access_role_count: number;
  network_policy_count: number;
  exposed_namespace_without_network_policy_count: number;
  workload_hardening_gap_count: number;
  service_account_token_automount_count: number;
  writable_root_filesystem_workload_count: number;
  default_service_account_automount_workload_count: number;
  secret_env_reference_count: number;
  secret_env_from_reference_count: number;
};

function parseReport(reportJson: string | null): { findings?: { severity?: Severity }[] } {
  if (!reportJson) return {};
  try {
    return JSON.parse(reportJson) as { findings?: { severity?: Severity }[] };
  } catch {
    return {};
  }
}

function parseNoiseCount(noiseJson: string | null): number {
  if (!noiseJson) return 0;
  try {
    const items = JSON.parse(noiseJson) as unknown[];
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

function deltaStatus(
  previous: string | number | boolean | null | undefined,
  current: string | number | boolean | null | undefined
): EvidenceDeltaStatus {
  const prev = previous ?? null;
  const curr = current ?? null;
  if (prev === curr) return "unchanged";
  if (prev === null) return "added";
  if (curr === null) return "removed";
  return "changed";
}

function metricRow(
  key: string,
  label: string,
  previous: string | number | boolean | null,
  current: string | number | boolean | null,
  family: EvidenceDeltaMetricRow["family"] = "common",
  unit: string | null = null
): EvidenceDeltaMetricRow | null {
  const status = deltaStatus(previous, current);
  if (status === "unchanged") return null;
  return { key, label, family, status, previous, current, unit };
}

function severityCounts(reportJson: string | null): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const finding of parseReport(reportJson).findings ?? []) {
    const severity = finding.severity;
    if (severity && severity in counts) counts[severity]++;
  }
  return counts;
}

export function buildEvidenceDelta(
  baseline: RunWithArtifactRow | null,
  current: RunWithArtifactRow
): EvidenceDeltaPayload | null {
  if (!baseline) return null;

  const metadata = {
    filename: deltaStatus(baseline.filename, current.filename),
    target_identifier: deltaStatus(baseline.target_identifier, current.target_identifier),
    collected_at: deltaStatus(baseline.collected_at, current.collected_at),
    collector_type: deltaStatus(baseline.collector_type, current.collector_type),
    collector_version: deltaStatus(baseline.collector_version, current.collector_version),
  };

  const baselineSeverityCounts = severityCounts(baseline.report_json);
  const currentSeverityCounts = severityCounts(current.report_json);
  const metrics = [
    metricRow(
      "environment_hostname",
      "Hostname",
      parseEnvironmentHostname(baseline.environment_json),
      parseEnvironmentHostname(current.environment_json)
    ),
    metricRow(
      "finding_count",
      "Finding count",
      (parseReport(baseline.report_json).findings ?? []).length,
      (parseReport(current.report_json).findings ?? []).length
    ),
    metricRow(
      "suppressed_noise_count",
      "Suppressed noise",
      parseNoiseCount(baseline.noise_json),
      parseNoiseCount(current.noise_json)
    ),
    metricRow(
      "incomplete_audit",
      "Incomplete audit",
      Boolean(baseline.is_incomplete),
      Boolean(current.is_incomplete)
    ),
    metricRow(
      "critical_findings",
      "Critical findings",
      baselineSeverityCounts.critical,
      currentSeverityCounts.critical
    ),
    metricRow(
      "high_findings",
      "High findings",
      baselineSeverityCounts.high,
      currentSeverityCounts.high
    ),
    metricRow(
      "medium_findings",
      "Medium findings",
      baselineSeverityCounts.medium,
      currentSeverityCounts.medium
    ),
    metricRow(
      "low_findings",
      "Low findings",
      baselineSeverityCounts.low,
      currentSeverityCounts.low
    ),
    ...buildFamilyMetrics(baseline, current),
  ].filter((row): row is EvidenceDeltaMetricRow => row !== null);

  const metadataChanged = Object.values(metadata).filter((status) => status !== "unchanged").length;
  const artifactChanged = baseline.artifact_id !== current.artifact_id;

  return {
    changed: artifactChanged || metadataChanged > 0 || metrics.length > 0,
    summary: {
      metadata_changed: metadataChanged,
      metric_changes: metrics.length,
      artifact_changed: artifactChanged,
    },
    metadata,
    metrics,
  };
}

function summarizeContainerEvidence(content: string): ContainerEvidenceSummary {
  const sections = parseContainerSections(content);
  return {
    published_port_count: parseContainerList(sections.published_ports).length,
    mount_count: parseContainerList(sections.mounts).length,
    writable_mount_count: parseContainerList(sections.writable_mounts).length,
    added_capability_count: parseContainerList(sections.added_capabilities).length,
    secret_mount_count: parseContainerList(sections.secrets).length,
    runs_as_root: ["true", "yes", "1", "on"].includes(
      (sections.ran_as_root ?? "").trim().toLowerCase()
    ),
    read_only_rootfs: ["true", "yes", "1", "on"].includes(
      (sections.read_only_rootfs ?? "").trim().toLowerCase()
    ),
  };
}

function hasResourceEntries(resources: Record<string, string> | undefined): boolean {
  return Boolean(resources && Object.keys(resources).length > 0);
}

function parseKubernetesJson<T>(doc: KubernetesBundleDocument): T[] {
  const parsed = parseKubernetesDocumentJson<T[]>(doc);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizedList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function secretEnvRefCount(container: KubernetesContainerSpec): number {
  return (container.env ?? []).filter((item) => item.valueFrom?.secretKeyRef != null).length;
}

function secretEnvFromRefCount(container: KubernetesContainerSpec): number {
  return (container.envFrom ?? []).filter((item) => item.secretRef != null).length;
}

function summarizeWorkloadHardeningGaps(workload: KubernetesWorkloadSpec): number {
  let gaps = 0;
  const podSecurityContext = workload.pod_spec?.securityContext;
  if (workload.pod_spec?.automountServiceAccountToken !== false) gaps += 1;
  for (const container of workload.pod_spec?.containers ?? []) {
    const securityContext = container.securityContext ?? {};
    const combinedSeccompType =
      securityContext.seccompProfile?.type ?? podSecurityContext?.seccompProfile?.type;
    const runAsNonRoot = securityContext.runAsNonRoot ?? podSecurityContext?.runAsNonRoot;
    const readOnlyRootFilesystem =
      securityContext.readOnlyRootFilesystem ?? podSecurityContext?.readOnlyRootFilesystem;

    if (securityContext.privileged) gaps += 1;
    if (securityContext.allowPrivilegeEscalation) gaps += 1;
    if (runAsNonRoot !== true) gaps += 1;
    if (combinedSeccompType !== "RuntimeDefault" && combinedSeccompType !== "Localhost") {
      gaps += 1;
    }
    if (readOnlyRootFilesystem !== true) gaps += 1;
    if (!container.livenessProbe || !container.readinessProbe) gaps += 1;

    const hasRequests = hasResourceEntries(container.resources?.requests);
    const hasLimits = hasResourceEntries(container.resources?.limits);
    if (!hasRequests || !hasLimits) gaps += 1;
  }

  return gaps;
}

function summarizeKubernetesEvidence(content: string): KubernetesEvidenceSummary {
  const manifest = parseKubernetesBundle(content);
  if (!manifest) {
    return {
      document_count: 0,
      external_service_count: 0,
      cluster_admin_binding_count: 0,
      rbac_wildcard_role_count: 0,
      rbac_privilege_escalation_role_count: 0,
      rbac_node_proxy_access_role_count: 0,
      network_policy_count: 0,
      exposed_namespace_without_network_policy_count: 0,
      workload_hardening_gap_count: 0,
      service_account_token_automount_count: 0,
      writable_root_filesystem_workload_count: 0,
      default_service_account_automount_workload_count: 0,
      secret_env_reference_count: 0,
      secret_env_from_reference_count: 0,
    };
  }

  let externalServiceCount = 0;
  let clusterAdminBindingCount = 0;
  let rbacWildcardRoleCount = 0;
  let rbacPrivilegeEscalationRoleCount = 0;
  let rbacNodeProxyAccessRoleCount = 0;
  let networkPolicyCount = 0;
  let workloadHardeningGapCount = 0;
  let serviceAccountTokenAutomountCount = 0;
  let writableRootFilesystemWorkloadCount = 0;
  let defaultServiceAccountAutomountWorkloadCount = 0;
  let secretEnvReferenceCount = 0;
  let secretEnvFromReferenceCount = 0;
  const externalServiceNamespaces = new Set<string>();
  const namespacesWithNetworkPolicy = new Set<string>();

  for (const doc of manifest.documents) {
    if (doc.kind === "service-exposure") {
      for (const service of parseKubernetesJson<KubernetesServiceExposure>(doc)) {
        const serviceType = service.type?.trim();
        const isExternal =
          service.external === true ||
          serviceType === "LoadBalancer" ||
          serviceType === "NodePort";
        if (!isExternal) continue;
        externalServiceCount += 1;
        if (service.namespace?.trim()) externalServiceNamespaces.add(service.namespace.trim());
      }
      continue;
    }

    if (doc.kind === "rbac-bindings") {
      for (const binding of parseKubernetesJson<KubernetesRbacBinding>(doc)) {
        if (binding.roleRef?.trim() === "cluster-admin") clusterAdminBindingCount += 1;
      }
      continue;
    }

    if (doc.kind === "rbac-roles") {
      for (const role of parseKubernetesJson<KubernetesRbacRole>(doc)) {
        let hasWildcardAccess = false;
        let hasPrivilegeEscalation = false;
        let hasNodeProxyAccess = false;

        for (const rule of role.rules ?? []) {
          const apiGroups = normalizedList(rule.apiGroups);
          const resources = normalizedList(rule.resources);
          const verbs = normalizedList(rule.verbs);

          if (apiGroups.includes("*") || resources.includes("*") || verbs.includes("*")) {
            hasWildcardAccess = true;
          }
          if (["bind", "escalate", "impersonate"].some((verb) => verbs.includes(verb))) {
            hasPrivilegeEscalation = true;
          }
          if (resources.includes("nodes/proxy")) {
            hasNodeProxyAccess = true;
          }
        }

        if (hasWildcardAccess) rbacWildcardRoleCount += 1;
        if (hasPrivilegeEscalation) rbacPrivilegeEscalationRoleCount += 1;
        if (hasNodeProxyAccess) rbacNodeProxyAccessRoleCount += 1;
      }
      continue;
    }

    if (doc.kind === "network-policies") {
      const policies = parseKubernetesJson<KubernetesNetworkPolicy>(doc);
      networkPolicyCount += policies.length;
      for (const policy of policies) {
        if (policy.namespace?.trim()) namespacesWithNetworkPolicy.add(policy.namespace.trim());
      }
      continue;
    }

    if (doc.kind === "workload-specs") {
      for (const workload of parseKubernetesJson<KubernetesWorkloadSpec>(doc)) {
        workloadHardeningGapCount += summarizeWorkloadHardeningGaps(workload);
        if (workload.pod_spec?.automountServiceAccountToken !== false) {
          serviceAccountTokenAutomountCount += 1;
        }
        const serviceAccountName = workload.pod_spec?.serviceAccountName?.trim() || "default";
        if (
          workload.pod_spec?.automountServiceAccountToken !== false &&
          serviceAccountName === "default"
        ) {
          defaultServiceAccountAutomountWorkloadCount += 1;
        }

        const podSecurityContext = workload.pod_spec?.securityContext;
        const hasWritableRootFilesystem = (workload.pod_spec?.containers ?? []).some((container) => {
          const securityContext = container.securityContext ?? {};
          const readOnlyRootFilesystem =
            securityContext.readOnlyRootFilesystem ?? podSecurityContext?.readOnlyRootFilesystem;
          return readOnlyRootFilesystem !== true;
        });
        if (hasWritableRootFilesystem) writableRootFilesystemWorkloadCount += 1;
        secretEnvReferenceCount += (workload.pod_spec?.containers ?? []).reduce(
          (total, container) => total + secretEnvRefCount(container),
          0
        );
        secretEnvFromReferenceCount += (workload.pod_spec?.containers ?? []).reduce(
          (total, container) => total + secretEnvFromRefCount(container),
          0
        );
      }
    }
  }

  let exposedNamespaceWithoutNetworkPolicyCount = 0;
  for (const namespace of externalServiceNamespaces) {
    if (!namespacesWithNetworkPolicy.has(namespace)) {
      exposedNamespaceWithoutNetworkPolicyCount += 1;
    }
  }

  return {
    document_count: manifest.documents.length,
    external_service_count: externalServiceCount,
    cluster_admin_binding_count: clusterAdminBindingCount,
    rbac_wildcard_role_count: rbacWildcardRoleCount,
    rbac_privilege_escalation_role_count: rbacPrivilegeEscalationRoleCount,
    rbac_node_proxy_access_role_count: rbacNodeProxyAccessRoleCount,
    network_policy_count: networkPolicyCount,
    exposed_namespace_without_network_policy_count: exposedNamespaceWithoutNetworkPolicyCount,
    workload_hardening_gap_count: workloadHardeningGapCount,
    service_account_token_automount_count: serviceAccountTokenAutomountCount,
    writable_root_filesystem_workload_count: writableRootFilesystemWorkloadCount,
    default_service_account_automount_workload_count: defaultServiceAccountAutomountWorkloadCount,
    secret_env_reference_count: secretEnvReferenceCount,
    secret_env_from_reference_count: secretEnvFromReferenceCount,
  };
}

function buildFamilyMetrics(
  baseline: RunWithArtifactRow,
  current: RunWithArtifactRow
): Array<EvidenceDeltaMetricRow | null> {
  if (baseline.artifact_type !== current.artifact_type) return [];

  if (current.artifact_type === "container-diagnostics") {
    const previous = summarizeContainerEvidence(baseline.artifact_content);
    const next = summarizeContainerEvidence(current.artifact_content);
    return [
      metricRow(
        "published_port_count",
        "Published ports",
        previous.published_port_count,
        next.published_port_count,
        "container-diagnostics"
      ),
      metricRow(
        "mount_count",
        "Mounted volumes",
        previous.mount_count,
        next.mount_count,
        "container-diagnostics"
      ),
      metricRow(
        "writable_mount_count",
        "Writable mounted volumes",
        previous.writable_mount_count,
        next.writable_mount_count,
        "container-diagnostics"
      ),
      metricRow(
        "added_capability_count",
        "Added Linux capabilities",
        previous.added_capability_count,
        next.added_capability_count,
        "container-diagnostics"
      ),
      metricRow(
        "secret_mount_count",
        "Mounted secrets",
        previous.secret_mount_count,
        next.secret_mount_count,
        "container-diagnostics"
      ),
      metricRow(
        "runs_as_root",
        "Runs as root",
        previous.runs_as_root,
        next.runs_as_root,
        "container-diagnostics"
      ),
      metricRow(
        "read_only_rootfs",
        "Read-only root filesystem",
        previous.read_only_rootfs,
        next.read_only_rootfs,
        "container-diagnostics"
      ),
    ];
  }

  if (current.artifact_type === "kubernetes-bundle") {
    const previous = summarizeKubernetesEvidence(baseline.artifact_content);
    const next = summarizeKubernetesEvidence(current.artifact_content);
    return [
      metricRow(
        "document_count",
        "Bundle documents",
        previous.document_count,
        next.document_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "external_service_count",
        "External services",
        previous.external_service_count,
        next.external_service_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "cluster_admin_binding_count",
        "Cluster-admin bindings",
        previous.cluster_admin_binding_count,
        next.cluster_admin_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "rbac_wildcard_role_count",
        "RBAC roles with wildcard access",
        previous.rbac_wildcard_role_count,
        next.rbac_wildcard_role_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "rbac_privilege_escalation_role_count",
        "RBAC roles with escalation verbs",
        previous.rbac_privilege_escalation_role_count,
        next.rbac_privilege_escalation_role_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "rbac_node_proxy_access_role_count",
        "RBAC roles with node proxy access",
        previous.rbac_node_proxy_access_role_count,
        next.rbac_node_proxy_access_role_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "network_policy_count",
        "NetworkPolicies",
        previous.network_policy_count,
        next.network_policy_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "exposed_namespace_without_network_policy_count",
        "Externally exposed namespaces without NetworkPolicy",
        previous.exposed_namespace_without_network_policy_count,
        next.exposed_namespace_without_network_policy_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "workload_hardening_gap_count",
        "Workload hardening gaps",
        previous.workload_hardening_gap_count,
        next.workload_hardening_gap_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "service_account_token_automount_count",
        "Workloads with service account token automount",
        previous.service_account_token_automount_count,
        next.service_account_token_automount_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "writable_root_filesystem_workload_count",
        "Workloads with writable root filesystems",
        previous.writable_root_filesystem_workload_count,
        next.writable_root_filesystem_workload_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "default_service_account_automount_workload_count",
        "Workloads using the default service account with token automount",
        previous.default_service_account_automount_workload_count,
        next.default_service_account_automount_workload_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "secret_env_reference_count",
        "Secret-backed environment references",
        previous.secret_env_reference_count,
        next.secret_env_reference_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "secret_env_from_reference_count",
        "Secret imports via envFrom",
        previous.secret_env_from_reference_count,
        next.secret_env_from_reference_count,
        "kubernetes-bundle"
      ),
    ];
  }

  return [];
}
