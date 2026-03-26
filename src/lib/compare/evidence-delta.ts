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
  scope?: string;
  namespace?: string;
  subject?: string;
  roleRef?: string;
};

type KubernetesRbacRule = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
};

type KubernetesRbacRole = {
  scope?: string;
  namespace?: string;
  name?: string;
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
  capabilities?: {
    add?: string[];
  } | null;
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

type KubernetesProjectedSource = {
  serviceAccountToken?: {
    audience?: string;
    expirationSeconds?: number;
    path?: string;
  } | null;
};

type KubernetesVolume = {
  name?: string;
  secret?: {
    secretName?: string;
  } | null;
  hostPath?: {
    path?: string;
  } | null;
  projected?: {
    sources?: KubernetesProjectedSource[];
  } | null;
};

type KubernetesVolumeMount = {
  name?: string;
  mountPath?: string;
  readOnly?: boolean;
};

type KubernetesContainerSpec = {
  env?: KubernetesEnvVar[];
  envFrom?: KubernetesEnvFromSource[];
  volumeMounts?: KubernetesVolumeMount[];
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
  hostNetwork?: boolean;
  hostPID?: boolean;
  hostIPC?: boolean;
  volumes?: KubernetesVolume[];
  securityContext?: KubernetesSecurityContext;
  containers?: KubernetesContainerSpec[];
  initContainers?: KubernetesContainerSpec[];
};

type KubernetesWorkloadSpec = {
  namespace?: string;
  pod_spec?: KubernetesPodSpec;
};

type KubernetesEvidenceSummary = {
  document_count: number;
  external_service_count: number;
  cluster_admin_binding_count: number;
  workload_cluster_admin_binding_count: number;
  workload_rbac_wildcard_binding_count: number;
  workload_rbac_privilege_escalation_binding_count: number;
  workload_rbac_node_proxy_binding_count: number;
  externally_exposed_workload_cluster_admin_binding_count: number;
  externally_exposed_workload_rbac_wildcard_binding_count: number;
  externally_exposed_workload_rbac_privilege_escalation_binding_count: number;
  externally_exposed_workload_rbac_node_proxy_binding_count: number;
  rbac_wildcard_role_count: number;
  rbac_privilege_escalation_role_count: number;
  rbac_node_proxy_access_role_count: number;
  network_policy_count: number;
  exposed_namespace_without_network_policy_count: number;
  workload_hardening_gap_count: number;
  service_account_token_automount_count: number;
  writable_root_filesystem_workload_count: number;
  default_service_account_automount_workload_count: number;
  externally_exposed_default_service_account_automount_workload_count: number;
  secret_env_reference_count: number;
  secret_env_from_reference_count: number;
  secret_volume_mount_count: number;
  projected_service_account_token_volume_count: number;
  externally_exposed_projected_service_account_token_volume_count: number;
  host_network_workload_count: number;
  host_pid_workload_count: number;
  host_ipc_workload_count: number;
  host_path_volume_mount_count: number;
  added_capability_count: number;
  privileged_init_container_count: number;
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

function serviceAccountKey(namespace: string | undefined, name: string | undefined): string | null {
  const trimmedNamespace = namespace?.trim();
  const trimmedName = name?.trim();
  if (!trimmedNamespace || !trimmedName) return null;
  return `${trimmedNamespace}/${trimmedName}`;
}

function parseServiceAccountSubjectKey(subject: string | undefined): string | null {
  const trimmedSubject = subject?.trim();
  if (!trimmedSubject) return null;
  if (trimmedSubject.startsWith("system:serviceaccount:")) {
    const [, , namespace, name, ...rest] = trimmedSubject.split(":");
    if (!namespace || !name || rest.length > 0) return null;
    return serviceAccountKey(namespace, name);
  }
  if (trimmedSubject.includes("/")) {
    const [namespace, name, ...rest] = trimmedSubject.split("/");
    if (!namespace || !name || rest.length > 0) return null;
    return serviceAccountKey(namespace, name);
  }
  return null;
}

function roleKey(
  scope: string | undefined,
  namespace: string | undefined,
  name: string | undefined
): string | null {
  const trimmedScope = scope?.trim() || "cluster";
  const trimmedName = name?.trim();
  if (!trimmedName) return null;
  if (trimmedScope === "namespace") {
    const trimmedNamespace = namespace?.trim();
    if (!trimmedNamespace) return null;
    return `namespace:${trimmedNamespace}:${trimmedName}`;
  }
  return `cluster:${trimmedName}`;
}

function secretEnvRefCount(container: KubernetesContainerSpec): number {
  return (container.env ?? []).filter((item) => item.valueFrom?.secretKeyRef != null).length;
}

function secretEnvFromRefCount(container: KubernetesContainerSpec): number {
  return (container.envFrom ?? []).filter((item) => item.secretRef != null).length;
}

function secretVolumeMountCount(workload: KubernetesWorkloadSpec): number {
  const secretVolumeNames = new Set(
    (workload.pod_spec?.volumes ?? [])
      .filter((volume) => volume.secret != null && volume.name?.trim())
      .map((volume) => volume.name!.trim())
  );
  if (secretVolumeNames.size === 0) return 0;

  return (workload.pod_spec?.containers ?? []).reduce(
    (total, container) =>
      total +
      (container.volumeMounts ?? []).filter((mount) => {
        const name = mount.name?.trim();
        return Boolean(name && secretVolumeNames.has(name));
      }).length,
    0
  );
}

function projectedServiceAccountTokenVolumeCount(workload: KubernetesWorkloadSpec): number {
  const projectedTokenVolumeNames = new Set(
    (workload.pod_spec?.volumes ?? [])
      .filter(
        (volume) =>
          volume.name?.trim() &&
          (volume.projected?.sources ?? []).some((source) => source.serviceAccountToken != null)
      )
      .map((volume) => volume.name!.trim())
  );
  if (projectedTokenVolumeNames.size === 0) return 0;

  return (workload.pod_spec?.containers ?? []).reduce(
    (total, container) =>
      total +
      (container.volumeMounts ?? []).filter((mount) => {
        const name = mount.name?.trim();
        return Boolean(name && projectedTokenVolumeNames.has(name));
      }).length,
    0
  );
}

function hostPathVolumeMountCount(workload: KubernetesWorkloadSpec): number {
  const hostPathVolumeNames = new Set(
    (workload.pod_spec?.volumes ?? [])
      .filter((volume) => volume.hostPath != null && volume.name?.trim())
      .map((volume) => volume.name!.trim())
  );
  if (hostPathVolumeNames.size === 0) return 0;

  return (workload.pod_spec?.containers ?? []).reduce(
    (total, container) =>
      total +
      (container.volumeMounts ?? []).filter((mount) => {
        const name = mount.name?.trim();
        return Boolean(name && hostPathVolumeNames.has(name));
      }).length,
    0
  );
}

function addedCapabilityCount(workload: KubernetesWorkloadSpec): number {
  return (workload.pod_spec?.containers ?? []).reduce(
    (total, container) =>
      total +
      normalizedList(container.securityContext?.capabilities?.add).length,
    0
  );
}

function privilegedInitContainerCount(workload: KubernetesWorkloadSpec): number {
  return (workload.pod_spec?.initContainers ?? []).filter(
    (container) => container.securityContext?.privileged === true
  ).length;
}

function summarizeWorkloadHardeningGaps(workload: KubernetesWorkloadSpec): number {
  let gaps = 0;
  const podSecurityContext = workload.pod_spec?.securityContext;
  if (workload.pod_spec?.automountServiceAccountToken !== false) gaps += 1;
  if (workload.pod_spec?.hostNetwork) gaps += 1;
  if (workload.pod_spec?.hostPID) gaps += 1;
  if (workload.pod_spec?.hostIPC) gaps += 1;
  if (hostPathVolumeMountCount(workload) > 0) gaps += 1;
  if (addedCapabilityCount(workload) > 0) gaps += 1;
  if (privilegedInitContainerCount(workload) > 0) gaps += 1;
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
      workload_cluster_admin_binding_count: 0,
      workload_rbac_wildcard_binding_count: 0,
      workload_rbac_privilege_escalation_binding_count: 0,
      workload_rbac_node_proxy_binding_count: 0,
      externally_exposed_workload_cluster_admin_binding_count: 0,
      externally_exposed_workload_rbac_wildcard_binding_count: 0,
      externally_exposed_workload_rbac_privilege_escalation_binding_count: 0,
      externally_exposed_workload_rbac_node_proxy_binding_count: 0,
      rbac_wildcard_role_count: 0,
      rbac_privilege_escalation_role_count: 0,
      rbac_node_proxy_access_role_count: 0,
      network_policy_count: 0,
      exposed_namespace_without_network_policy_count: 0,
      workload_hardening_gap_count: 0,
      service_account_token_automount_count: 0,
      writable_root_filesystem_workload_count: 0,
      default_service_account_automount_workload_count: 0,
      externally_exposed_default_service_account_automount_workload_count: 0,
      secret_env_reference_count: 0,
      secret_env_from_reference_count: 0,
      secret_volume_mount_count: 0,
      projected_service_account_token_volume_count: 0,
      externally_exposed_projected_service_account_token_volume_count: 0,
      host_network_workload_count: 0,
      host_pid_workload_count: 0,
      host_ipc_workload_count: 0,
      host_path_volume_mount_count: 0,
      added_capability_count: 0,
      privileged_init_container_count: 0,
    };
  }

  let externalServiceCount = 0;
  let clusterAdminBindingCount = 0;
  let workloadClusterAdminBindingCount = 0;
  let workloadRbacWildcardBindingCount = 0;
  let workloadRbacPrivilegeEscalationBindingCount = 0;
  let workloadRbacNodeProxyBindingCount = 0;
  let externallyExposedWorkloadClusterAdminBindingCount = 0;
  let externallyExposedWorkloadRbacWildcardBindingCount = 0;
  let externallyExposedWorkloadRbacPrivilegeEscalationBindingCount = 0;
  let externallyExposedWorkloadRbacNodeProxyBindingCount = 0;
  let rbacWildcardRoleCount = 0;
  let rbacPrivilegeEscalationRoleCount = 0;
  let rbacNodeProxyAccessRoleCount = 0;
  let networkPolicyCount = 0;
  let workloadHardeningGapCount = 0;
  let serviceAccountTokenAutomountCount = 0;
  let writableRootFilesystemWorkloadCount = 0;
  let defaultServiceAccountAutomountWorkloadCount = 0;
  let externallyExposedDefaultServiceAccountAutomountWorkloadCount = 0;
  let secretEnvReferenceCount = 0;
  let secretEnvFromReferenceCount = 0;
  let secretVolumeMountCountTotal = 0;
  let projectedServiceAccountTokenVolumeCountTotal = 0;
  let externallyExposedProjectedServiceAccountTokenVolumeCountTotal = 0;
  let hostNetworkWorkloadCount = 0;
  let hostPidWorkloadCount = 0;
  let hostIpcWorkloadCount = 0;
  let hostPathVolumeMountCountTotal = 0;
  let addedCapabilityCountTotal = 0;
  let privilegedInitContainerCountTotal = 0;
  const externalServiceNamespaces = new Set<string>();
  const namespacesWithNetworkPolicy = new Set<string>();
  const clusterAdminServiceAccounts = new Set<string>();
  const wildcardRoleKeys = new Set<string>();
  const escalationRoleKeys = new Set<string>();
  const nodeProxyRoleKeys = new Set<string>();
  const serviceAccountRoleBindings = new Map<string, Set<string>>();

  for (const doc of manifest.documents) {
    if (doc.kind !== "service-exposure") continue;
    for (const service of parseKubernetesJson<KubernetesServiceExposure>(doc)) {
      const serviceType = service.type?.trim();
      const isExternal =
        service.external === true ||
        serviceType === "LoadBalancer" ||
        serviceType === "NodePort";
      if (!isExternal) continue;
      externalServiceCount += 1;
      const namespace = service.namespace?.trim();
      if (namespace) externalServiceNamespaces.add(namespace);
    }
  }

  for (const doc of manifest.documents) {
    if (doc.kind === "service-exposure") {
      continue;
    }

    if (doc.kind === "rbac-bindings") {
      for (const binding of parseKubernetesJson<KubernetesRbacBinding>(doc)) {
        const subjectKey = parseServiceAccountSubjectKey(binding.subject);
        const bindingRoleKey = roleKey(binding.scope, binding.namespace, binding.roleRef);
        if (subjectKey && bindingRoleKey) {
          let roleBindings = serviceAccountRoleBindings.get(subjectKey);
          if (!roleBindings) {
            roleBindings = new Set<string>();
            serviceAccountRoleBindings.set(subjectKey, roleBindings);
          }
          roleBindings.add(bindingRoleKey);
        }

        if (binding.roleRef?.trim() === "cluster-admin") {
          clusterAdminBindingCount += 1;
          if (subjectKey) clusterAdminServiceAccounts.add(subjectKey);
        }
      }
      continue;
    }

    if (doc.kind === "rbac-roles") {
      for (const role of parseKubernetesJson<KubernetesRbacRole>(doc)) {
        const currentRoleKey = roleKey(role.scope, role.namespace, role.name);
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

        if (hasWildcardAccess) {
          rbacWildcardRoleCount += 1;
          if (currentRoleKey) wildcardRoleKeys.add(currentRoleKey);
        }
        if (hasPrivilegeEscalation) {
          rbacPrivilegeEscalationRoleCount += 1;
          if (currentRoleKey) escalationRoleKeys.add(currentRoleKey);
        }
        if (hasNodeProxyAccess) {
          rbacNodeProxyAccessRoleCount += 1;
          if (currentRoleKey) nodeProxyRoleKeys.add(currentRoleKey);
        }
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
        if (workload.pod_spec?.hostNetwork) hostNetworkWorkloadCount += 1;
        if (workload.pod_spec?.hostPID) hostPidWorkloadCount += 1;
        if (workload.pod_spec?.hostIPC) hostIpcWorkloadCount += 1;
        const serviceAccountName = workload.pod_spec?.serviceAccountName?.trim() || "default";
        const workloadServiceAccountKey = serviceAccountKey(workload.namespace, serviceAccountName);
        const workloadNamespace = workload.namespace?.trim();
        const workloadInExposedNamespace =
          workloadNamespace !== undefined &&
          workloadNamespace.length > 0 &&
          externalServiceNamespaces.has(workloadNamespace);
        if (
          workload.pod_spec?.automountServiceAccountToken !== false &&
          serviceAccountName === "default"
        ) {
          defaultServiceAccountAutomountWorkloadCount += 1;
          if (workloadInExposedNamespace) {
            externallyExposedDefaultServiceAccountAutomountWorkloadCount += 1;
          }
        }
        if (
          workloadServiceAccountKey &&
          clusterAdminServiceAccounts.has(workloadServiceAccountKey)
        ) {
          workloadClusterAdminBindingCount += 1;
        }
        const workloadRoleBindings =
          (workloadServiceAccountKey &&
            serviceAccountRoleBindings.get(workloadServiceAccountKey)) ||
          new Set<string>();
        const wildcardBindingCount = Array.from(workloadRoleBindings).filter((bindingRoleKey) =>
          wildcardRoleKeys.has(bindingRoleKey)
        ).length;
        const escalationBindingCount = Array.from(workloadRoleBindings).filter((bindingRoleKey) =>
          escalationRoleKeys.has(bindingRoleKey)
        ).length;
        const nodeProxyBindingCount = Array.from(workloadRoleBindings).filter((bindingRoleKey) =>
          nodeProxyRoleKeys.has(bindingRoleKey)
        ).length;
        workloadRbacWildcardBindingCount += wildcardBindingCount;
        workloadRbacPrivilegeEscalationBindingCount += escalationBindingCount;
        workloadRbacNodeProxyBindingCount += nodeProxyBindingCount;
        if (workloadInExposedNamespace) {
          if (
            workloadServiceAccountKey &&
            clusterAdminServiceAccounts.has(workloadServiceAccountKey)
          ) {
            externallyExposedWorkloadClusterAdminBindingCount += 1;
          }
          externallyExposedWorkloadRbacWildcardBindingCount += wildcardBindingCount;
          externallyExposedWorkloadRbacPrivilegeEscalationBindingCount += escalationBindingCount;
          externallyExposedWorkloadRbacNodeProxyBindingCount += nodeProxyBindingCount;
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
        secretVolumeMountCountTotal += secretVolumeMountCount(workload);
        projectedServiceAccountTokenVolumeCountTotal +=
          projectedServiceAccountTokenVolumeCount(workload);
        if (workloadInExposedNamespace) {
          externallyExposedProjectedServiceAccountTokenVolumeCountTotal +=
            projectedServiceAccountTokenVolumeCount(workload);
        }
        hostPathVolumeMountCountTotal += hostPathVolumeMountCount(workload);
        addedCapabilityCountTotal += addedCapabilityCount(workload);
        privilegedInitContainerCountTotal += privilegedInitContainerCount(workload);
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
    workload_cluster_admin_binding_count: workloadClusterAdminBindingCount,
    workload_rbac_wildcard_binding_count: workloadRbacWildcardBindingCount,
    workload_rbac_privilege_escalation_binding_count:
      workloadRbacPrivilegeEscalationBindingCount,
    workload_rbac_node_proxy_binding_count: workloadRbacNodeProxyBindingCount,
    externally_exposed_workload_cluster_admin_binding_count:
      externallyExposedWorkloadClusterAdminBindingCount,
    externally_exposed_workload_rbac_wildcard_binding_count:
      externallyExposedWorkloadRbacWildcardBindingCount,
    externally_exposed_workload_rbac_privilege_escalation_binding_count:
      externallyExposedWorkloadRbacPrivilegeEscalationBindingCount,
    externally_exposed_workload_rbac_node_proxy_binding_count:
      externallyExposedWorkloadRbacNodeProxyBindingCount,
    rbac_wildcard_role_count: rbacWildcardRoleCount,
    rbac_privilege_escalation_role_count: rbacPrivilegeEscalationRoleCount,
    rbac_node_proxy_access_role_count: rbacNodeProxyAccessRoleCount,
    network_policy_count: networkPolicyCount,
    exposed_namespace_without_network_policy_count: exposedNamespaceWithoutNetworkPolicyCount,
    workload_hardening_gap_count: workloadHardeningGapCount,
    service_account_token_automount_count: serviceAccountTokenAutomountCount,
    writable_root_filesystem_workload_count: writableRootFilesystemWorkloadCount,
    default_service_account_automount_workload_count: defaultServiceAccountAutomountWorkloadCount,
    externally_exposed_default_service_account_automount_workload_count:
      externallyExposedDefaultServiceAccountAutomountWorkloadCount,
    secret_env_reference_count: secretEnvReferenceCount,
    secret_env_from_reference_count: secretEnvFromReferenceCount,
    secret_volume_mount_count: secretVolumeMountCountTotal,
    projected_service_account_token_volume_count: projectedServiceAccountTokenVolumeCountTotal,
    externally_exposed_projected_service_account_token_volume_count:
      externallyExposedProjectedServiceAccountTokenVolumeCountTotal,
    host_network_workload_count: hostNetworkWorkloadCount,
    host_pid_workload_count: hostPidWorkloadCount,
    host_ipc_workload_count: hostIpcWorkloadCount,
    host_path_volume_mount_count: hostPathVolumeMountCountTotal,
    added_capability_count: addedCapabilityCountTotal,
    privileged_init_container_count: privilegedInitContainerCountTotal,
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
        "workload_cluster_admin_binding_count",
        "Workloads bound to cluster-admin",
        previous.workload_cluster_admin_binding_count,
        next.workload_cluster_admin_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "workload_rbac_wildcard_binding_count",
        "Workload bindings to wildcard RBAC roles",
        previous.workload_rbac_wildcard_binding_count,
        next.workload_rbac_wildcard_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "workload_rbac_privilege_escalation_binding_count",
        "Workload bindings to escalation RBAC roles",
        previous.workload_rbac_privilege_escalation_binding_count,
        next.workload_rbac_privilege_escalation_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "workload_rbac_node_proxy_binding_count",
        "Workload bindings to node proxy RBAC roles",
        previous.workload_rbac_node_proxy_binding_count,
        next.workload_rbac_node_proxy_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "externally_exposed_workload_cluster_admin_binding_count",
        "Externally exposed workloads bound to cluster-admin",
        previous.externally_exposed_workload_cluster_admin_binding_count,
        next.externally_exposed_workload_cluster_admin_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "externally_exposed_workload_rbac_wildcard_binding_count",
        "Externally exposed workload bindings to wildcard RBAC roles",
        previous.externally_exposed_workload_rbac_wildcard_binding_count,
        next.externally_exposed_workload_rbac_wildcard_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "externally_exposed_workload_rbac_privilege_escalation_binding_count",
        "Externally exposed workload bindings to escalation RBAC roles",
        previous.externally_exposed_workload_rbac_privilege_escalation_binding_count,
        next.externally_exposed_workload_rbac_privilege_escalation_binding_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "externally_exposed_workload_rbac_node_proxy_binding_count",
        "Externally exposed workload bindings to node proxy RBAC roles",
        previous.externally_exposed_workload_rbac_node_proxy_binding_count,
        next.externally_exposed_workload_rbac_node_proxy_binding_count,
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
        "externally_exposed_default_service_account_automount_workload_count",
        "Externally exposed workloads using the default service account with token automount",
        previous.externally_exposed_default_service_account_automount_workload_count,
        next.externally_exposed_default_service_account_automount_workload_count,
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
      metricRow(
        "secret_volume_mount_count",
        "Mounted Secret volumes",
        previous.secret_volume_mount_count,
        next.secret_volume_mount_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "projected_service_account_token_volume_count",
        "Mounted projected service account token volumes",
        previous.projected_service_account_token_volume_count,
        next.projected_service_account_token_volume_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "externally_exposed_projected_service_account_token_volume_count",
        "Projected service account token volumes on externally exposed workloads",
        previous.externally_exposed_projected_service_account_token_volume_count,
        next.externally_exposed_projected_service_account_token_volume_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "host_network_workload_count",
        "Workloads sharing the host network namespace",
        previous.host_network_workload_count,
        next.host_network_workload_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "host_pid_workload_count",
        "Workloads sharing the host PID namespace",
        previous.host_pid_workload_count,
        next.host_pid_workload_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "host_ipc_workload_count",
        "Workloads sharing the host IPC namespace",
        previous.host_ipc_workload_count,
        next.host_ipc_workload_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "host_path_volume_mount_count",
        "Mounted hostPath volumes",
        previous.host_path_volume_mount_count,
        next.host_path_volume_mount_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "added_capability_count",
        "Added Linux capabilities",
        previous.added_capability_count,
        next.added_capability_count,
        "kubernetes-bundle"
      ),
      metricRow(
        "privileged_init_container_count",
        "Privileged init containers",
        previous.privileged_init_container_count,
        next.privileged_init_container_count,
        "kubernetes-bundle"
      ),
    ];
  }

  return [];
}
