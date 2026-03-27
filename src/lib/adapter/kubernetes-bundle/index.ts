import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema";
import type { ArtifactAdapter } from "../types";
import {
  parseKubernetesBundle,
  parseKubernetesDocumentJson,
  type KubernetesBundleManifest,
  type KubernetesHorizontalPodAutoscaler,
  type KubernetesLimitRange,
  type KubernetesNodeTop,
  type KubernetesNodeHealth,
  type KubernetesPersistentVolume,
  type KubernetesPersistentVolumeClaim,
  type KubernetesPodDisruptionBudget,
  type KubernetesPodTop,
  type KubernetesResourceQuota,
  type KubernetesUnhealthyWorkloadLogExcerpt,
  type KubernetesWarningEvent,
  type KubernetesWorkloadRolloutStatus,
} from "./parse";

const MANIFEST_KEY = "__manifest_json";

type KubernetesServiceExposure = {
  namespace?: string;
  name?: string;
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

type KubernetesWorkloadStatus = {
  namespace?: string;
  name?: string;
  status?: string;
  restarts?: number;
};

type KubernetesNetworkPolicy = {
  namespace?: string;
  name?: string;
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
  name?: string;
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
  persistentVolumeClaim?: {
    claimName?: string;
  } | null;
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
  name?: string;
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
  name?: string;
  kind?: string;
  pod_spec?: KubernetesPodSpec;
};

type WarningEventCategory = {
  key: string;
  title: string;
  severity_hint: "high" | "medium";
  rule_id: string;
};

type NamespaceResourceDefaults = {
  hasDefaultRequests: boolean;
  hasDefaultLimits: boolean;
};

function manifestFromSections(sections: Record<string, string>): KubernetesBundleManifest | null {
  return parseKubernetesBundle(sections[MANIFEST_KEY] ?? "");
}

function workloadLabel(namespace: string | undefined, name: string | undefined): string {
  if (namespace && name) return `${namespace}/${name}`;
  return name || namespace || "unknown-workload";
}

function roleLabel(
  scope: string | undefined,
  namespace: string | undefined,
  name: string | undefined
): string {
  const trimmedScope = scope?.trim();
  const trimmedNamespace = namespace?.trim();
  const trimmedName = name?.trim();
  if (trimmedScope === "namespace" && trimmedNamespace && trimmedName) {
    return `${trimmedNamespace}/${trimmedName}`;
  }
  return trimmedName || trimmedNamespace || trimmedScope || "unknown-role";
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

function hasResourceEntries(resources: Record<string, string> | undefined): boolean {
  return Boolean(resources && Object.keys(resources).length > 0);
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

function persistentVolumeClaimNames(workload: KubernetesWorkloadSpec): string[] {
  return (workload.pod_spec?.volumes ?? [])
    .map((volume) => volume.persistentVolumeClaim?.claimName?.trim() ?? "")
    .filter(Boolean);
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

function normalizedValue(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function warningEventCategory(event: KubernetesWarningEvent): WarningEventCategory | null {
  const reason = normalizedValue(event.reason);
  const message = normalizedValue(event.message);

  if (
    ["failedscheduling", "notscaleup", "notscalesup"].includes(reason) ||
    message.includes("insufficient") ||
    message.includes("didn't match pod affinity") ||
    message.includes("taint")
  ) {
    return {
      key: "scheduling",
      title: "Kubernetes warning events indicate scheduling failures",
      severity_hint: "high",
      rule_id: "kubernetes.warning_events_scheduling",
    };
  }

  if (
    ["errimagepull", "imagepullbackoff", "failedpull", "inspectfailed"].includes(reason) ||
    message.includes("pull image") ||
    message.includes("imagepullbackoff")
  ) {
    return {
      key: "image-pull",
      title: "Kubernetes warning events indicate image pull failures",
      severity_hint: "high",
      rule_id: "kubernetes.warning_events_image_pull",
    };
  }

  if (
    ["failedmount", "failedattachvolume", "failedmapvolume"].includes(reason) ||
    message.includes("mountvolume") ||
    message.includes("unmounted volumes") ||
    message.includes("unable to attach or mount volumes")
  ) {
    return {
      key: "mounts",
      title: "Kubernetes warning events indicate mount or volume failures",
      severity_hint: "high",
      rule_id: "kubernetes.warning_events_mounts",
    };
  }

  if (
    ["backoff", "unhealthy", "failed", "failedcreatepodsandbox"].includes(reason) ||
    message.includes("back-off") ||
    message.includes("crashloopbackoff") ||
    message.includes("readiness probe failed") ||
    message.includes("liveness probe failed")
  ) {
    return {
      key: "runtime",
      title: "Kubernetes warning events indicate runtime instability",
      severity_hint: "medium",
      rule_id: "kubernetes.warning_events_runtime",
    };
  }

  if (
    ["evicted", "oomkilled", "preempted"].includes(reason) ||
    message.includes("evict") ||
    message.includes("oom")
  ) {
    return {
      key: "pressure",
      title: "Kubernetes warning events indicate eviction or OOM pressure",
      severity_hint: "high",
      rule_id: "kubernetes.warning_events_pressure",
    };
  }

  return null;
}

function rolloutMismatchSummary(status: KubernetesWorkloadRolloutStatus): {
  desired: number;
  ready: number;
  available: number;
  updated: number;
  unavailable: number;
  controllerLag: boolean;
  hasReplicaMismatch: boolean;
} | null {
  const desired = status.desired_replicas ?? 0;
  if (desired <= 0) return null;
  const ready = status.ready_replicas ?? 0;
  const available = status.available_replicas ?? 0;
  const updated = status.updated_replicas ?? 0;
  const unavailable = status.unavailable_replicas ?? Math.max(desired - available, 0);
  const generation = status.generation ?? null;
  const observedGeneration = status.observed_generation ?? null;
  const controllerLag =
    generation !== null && observedGeneration !== null && observedGeneration < generation;
  const hasReplicaMismatch = ready < desired || available < desired || updated < desired;

  return {
    desired,
    ready,
    available,
    updated,
    unavailable,
    controllerLag,
    hasReplicaMismatch,
  };
}

function percentLabel(value: number | null | undefined): string {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function isTrueStatus(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export class KubernetesBundleAdapter implements ArtifactAdapter {
  readonly type = "kubernetes-bundle";

  stripNoise(raw: string): string {
    return raw.replace(/\r\n/g, "\n").trim();
  }

  parseSections(clean: string): Record<string, string> {
    const manifest = parseKubernetesBundle(clean);
    if (!manifest) {
      return {
        [MANIFEST_KEY]: clean,
        parse_error: "invalid_kubernetes_bundle_manifest",
      };
    }

    return {
      [MANIFEST_KEY]: clean,
      schema_version: manifest.schema_version,
      cluster_name: manifest.cluster.name,
      cluster_provider: manifest.cluster.provider ?? "",
      scope_level: manifest.scope.level,
      scope_namespace: manifest.scope.namespace ?? "",
      document_count: String(manifest.documents.length),
    };
  }

  detectEnvironment(sections: Record<string, string>): EnvironmentContext {
    const manifest = manifestFromSections(sections);
    const clusterName = manifest?.cluster.name?.trim() || sections.cluster_name || "unknown-cluster";
    const provider = manifest?.cluster.provider?.trim() || sections.cluster_provider || "unknown";
    const scopeLevel = manifest?.scope.level || sections.scope_level || "cluster";
    const namespace = manifest?.scope.namespace?.trim() || sections.scope_namespace || null;

    return {
      hostname: clusterName,
      os: `Kubernetes (${provider})`,
      kernel:
        scopeLevel === "namespace" && namespace
          ? `namespace:${namespace}`
          : "cluster-scope",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: false,
      uptime: "unknown",
    };
  }

  classifyNoise(_sections: Record<string, string>, _env: EnvironmentContext): NoiseItem[] {
    const manifest = manifestFromSections(_sections);
    if (!manifest) return [];

    const noise: NoiseItem[] = [];

    for (const doc of manifest.documents) {
      if (doc.kind !== "workload-status") continue;
      const workloads = parseKubernetesDocumentJson<KubernetesWorkloadStatus[]>(doc) ?? [];
      for (const workload of workloads) {
        const status = workload.status?.trim();
        const normalizedStatus = status?.toLowerCase();
        const restarts = workload.restarts ?? 0;
        const label = workloadLabel(workload.namespace, workload.name);

        if (
          status &&
          restarts === 0 &&
          ["healthy", "running", "ready"].includes(normalizedStatus ?? "")
        ) {
          noise.push({
            observation: `Kubernetes workload healthy: ${label} (${status})`,
            reason_expected:
              "Healthy zero-restart workload status is expected platform state and does not need a diagnostic finding.",
            related_environment: "Kubernetes",
          });
          continue;
        }

        if (status && ["succeeded", "completed"].includes(normalizedStatus ?? "")) {
          noise.push({
            observation: `Kubernetes workload completed successfully: ${label} (${status})`,
            reason_expected:
              "Completed workload status is expected for finished jobs and should not be treated as an active platform problem by itself.",
            related_environment: "Kubernetes",
          });
        }
      }
    }

    return noise;
  }

  extractPreFindings(
    sections: Record<string, string>,
    _env: EnvironmentContext
  ): PreFinding[] {
    const manifest = manifestFromSections(sections);
    if (!manifest) return [];

    const findings: PreFinding[] = [];
    const externalServiceNamespaces = new Set<string>();
    const namespacesWithNetworkPolicy = new Set<string>();
    const clusterAdminServiceAccounts = new Set<string>();
    const wildcardRoleKeys = new Set<string>();
    const escalationRoleKeys = new Set<string>();
    const nodeProxyRoleKeys = new Set<string>();
    const serviceAccountRoleBindings = new Map<string, Set<string>>();
    const namespacesWithWorkloads = new Set<string>();
    const namespaceLimitRanges = new Map<string, NamespaceResourceDefaults>();
    const pendingPersistentVolumeClaims = new Map<string, KubernetesPersistentVolumeClaim>();
    const resizePendingPersistentVolumeClaims = new Map<string, KubernetesPersistentVolumeClaim>();

    for (const doc of manifest.documents) {
      if (doc.kind !== "rbac-roles") continue;
      const roles = parseKubernetesDocumentJson<KubernetesRbacRole[]>(doc) ?? [];
      for (const role of roles) {
        const currentRoleKey = roleKey(role.scope, role.namespace, role.name);
        if (!currentRoleKey) continue;

        let hasWildcardAccess = false;
        let hasNodeProxyAccess = false;
        let hasEscalationVerbs = false;

        for (const rule of role.rules ?? []) {
          const apiGroups = normalizedList(rule.apiGroups);
          const resources = normalizedList(rule.resources);
          const verbs = normalizedList(rule.verbs);

          if (apiGroups.includes("*") || resources.includes("*") || verbs.includes("*")) {
            hasWildcardAccess = true;
          }
          if (["bind", "escalate", "impersonate"].some((verb) => verbs.includes(verb))) {
            hasEscalationVerbs = true;
          }
          if (resources.includes("nodes/proxy")) {
            hasNodeProxyAccess = true;
          }
        }

        if (hasWildcardAccess) wildcardRoleKeys.add(currentRoleKey);
        if (hasEscalationVerbs) escalationRoleKeys.add(currentRoleKey);
        if (hasNodeProxyAccess) nodeProxyRoleKeys.add(currentRoleKey);
      }
    }

    for (const doc of manifest.documents) {
      if (doc.kind !== "service-exposure") continue;
      const services = parseKubernetesDocumentJson<KubernetesServiceExposure[]>(doc) ?? [];
      for (const service of services) {
        const serviceType = service.type?.trim();
        const isExternal =
          service.external === true ||
          serviceType === "LoadBalancer" ||
          serviceType === "NodePort";
        if (!isExternal) continue;
        const namespace = service.namespace?.trim();
        if (namespace) externalServiceNamespaces.add(namespace);
      }
    }

    for (const doc of manifest.documents) {
      if (doc.kind !== "rbac-bindings") continue;
      const bindings = parseKubernetesDocumentJson<KubernetesRbacBinding[]>(doc) ?? [];
      for (const binding of bindings) {
        const roleRef = binding.roleRef?.trim().toLowerCase();
        const subjectKey = parseServiceAccountSubjectKey(binding.subject);
        if (subjectKey) {
          const bindingRoleKey = roleKey(binding.scope, binding.namespace, binding.roleRef);
          if (bindingRoleKey) {
            let roleBindings = serviceAccountRoleBindings.get(subjectKey);
            if (!roleBindings) {
              roleBindings = new Set<string>();
              serviceAccountRoleBindings.set(subjectKey, roleBindings);
            }
            roleBindings.add(bindingRoleKey);
          }
          if (roleRef === "cluster-admin") clusterAdminServiceAccounts.add(subjectKey);
        }
      }
    }

    for (const doc of manifest.documents) {
      if (doc.kind === "service-exposure") {
        const services = parseKubernetesDocumentJson<KubernetesServiceExposure[]>(doc) ?? [];
        for (const service of services) {
          const serviceType = service.type?.trim();
          const isExternal =
            service.external === true ||
            serviceType === "LoadBalancer" ||
            serviceType === "NodePort";
          if (!isExternal) continue;
          const label = workloadLabel(service.namespace, service.name);
          const namespace = service.namespace?.trim();
          if (namespace) externalServiceNamespaces.add(namespace);
          findings.push({
            title: `Kubernetes Service exposed externally: ${label} (${serviceType ?? "external"})`,
            severity_hint: "high",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify(service),
            rule_id: "kubernetes.service_external",
          });
        }
      }

      if (doc.kind === "network-policies") {
        const policies = parseKubernetesDocumentJson<KubernetesNetworkPolicy[]>(doc) ?? [];
        for (const policy of policies) {
          if (policy.namespace?.trim()) namespacesWithNetworkPolicy.add(policy.namespace.trim());
        }
      }

      if (doc.kind === "rbac-bindings") {
        const bindings = parseKubernetesDocumentJson<KubernetesRbacBinding[]>(doc) ?? [];
        for (const binding of bindings) {
          const roleRef = binding.roleRef?.trim().toLowerCase();
          if (roleRef !== "cluster-admin") continue;
          findings.push({
            title: `Cluster-admin binding grants broad access: ${binding.subject ?? "unknown-subject"}`,
            severity_hint: "high",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify(binding),
            rule_id: "kubernetes.cluster_admin_binding",
          });
        }
      }

      if (doc.kind === "rbac-roles") {
        const roles = parseKubernetesDocumentJson<KubernetesRbacRole[]>(doc) ?? [];
        for (const role of roles) {
          const label = roleLabel(role.scope, role.namespace, role.name);
          let hasWildcardAccess = false;
          let hasNodeProxyAccess = false;
          const escalationVerbs = new Set<string>();

          for (const rule of role.rules ?? []) {
            const apiGroups = normalizedList(rule.apiGroups);
            const resources = normalizedList(rule.resources);
            const verbs = normalizedList(rule.verbs);

            if (
              apiGroups.includes("*") ||
              resources.includes("*") ||
              verbs.includes("*")
            ) {
              hasWildcardAccess = true;
            }

            for (const verb of ["bind", "escalate", "impersonate"] as const) {
              if (verbs.includes(verb)) escalationVerbs.add(verb);
            }

            if (resources.includes("nodes/proxy")) {
              hasNodeProxyAccess = true;
            }
          }

          if (hasWildcardAccess) {
            findings.push({
              title: `Kubernetes RBAC role grants wildcard access: ${label}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(role),
              rule_id: "kubernetes.rbac_wildcard_access",
            });
          }

          if (escalationVerbs.size > 0) {
            findings.push({
              title: `Kubernetes RBAC role grants privilege-escalation verbs: ${label} (${Array.from(escalationVerbs).join(", ")})`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(role),
              rule_id: "kubernetes.rbac_privilege_escalation_verbs",
            });
          }

          if (hasNodeProxyAccess) {
            findings.push({
              title: `Kubernetes RBAC role can access kubelet or node proxy APIs: ${label}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(role),
              rule_id: "kubernetes.rbac_node_proxy_access",
            });
          }
        }
      }

      if (doc.kind === "workload-status") {
        const workloads = parseKubernetesDocumentJson<KubernetesWorkloadStatus[]>(doc) ?? [];
        for (const workload of workloads) {
          if (workload.status !== "CrashLoopBackOff") continue;
          const label = workloadLabel(workload.namespace, workload.name);
          findings.push({
            title: `Kubernetes workload unstable: ${label} in CrashLoopBackOff`,
            severity_hint: "medium",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify(workload),
            rule_id: "kubernetes.crash_loop",
          });
        }
      }

      if (doc.kind === "node-health") {
        const nodes = parseKubernetesDocumentJson<KubernetesNodeHealth[]>(doc) ?? [];
        for (const node of nodes) {
          const nodeName = node.name?.trim() || "unknown-node";
          const pressureConditions = (node.pressure_conditions ?? []).filter((value) =>
            value.trim()
          );

          if (node.ready === false) {
            findings.push({
              title: `Kubernetes node is not Ready: ${nodeName}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(node),
              rule_id: "kubernetes.node_not_ready",
            });
          }

          if (pressureConditions.length > 0) {
            findings.push({
              title: `Kubernetes node reports pressure conditions: ${nodeName} (${pressureConditions.join(", ")})`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(node),
              rule_id: "kubernetes.node_pressure",
            });
          }
        }
      }

      if (doc.kind === "warning-events") {
        const events = parseKubernetesDocumentJson<KubernetesWarningEvent[]>(doc) ?? [];
        const grouped = new Map<
          string,
          {
            category: WarningEventCategory;
            totalCount: number;
            namespaces: Set<string>;
            affectedObjects: Set<string>;
            samples: KubernetesWarningEvent[];
          }
        >();

        for (const event of events) {
          const category = warningEventCategory(event);
          if (!category) continue;

          let bucket = grouped.get(category.key);
          if (!bucket) {
            bucket = {
              category,
              totalCount: 0,
              namespaces: new Set<string>(),
              affectedObjects: new Set<string>(),
              samples: [],
            };
            grouped.set(category.key, bucket);
          }

          bucket.totalCount += Math.max(1, event.count ?? 1);
          if (event.namespace?.trim()) bucket.namespaces.add(event.namespace.trim());
          const objectLabel =
            [event.involved_kind?.trim(), event.involved_name?.trim()]
              .filter(Boolean)
              .join("/")
              .trim() || "unknown-object";
          bucket.affectedObjects.add(objectLabel);
          if (bucket.samples.length < 3) bucket.samples.push(event);
        }

        for (const bucket of grouped.values()) {
          findings.push({
            title: `${bucket.category.title} (${bucket.totalCount} events)`,
            severity_hint: bucket.category.severity_hint,
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify({
              warning_event_count: bucket.totalCount,
              namespaces: Array.from(bucket.namespaces).sort(),
              affected_objects: Array.from(bucket.affectedObjects).sort(),
              samples: bucket.samples,
            }),
            rule_id: bucket.category.rule_id,
          });
        }
      }

      if (doc.kind === "unhealthy-workload-log-excerpts") {
        const excerpts =
          parseKubernetesDocumentJson<KubernetesUnhealthyWorkloadLogExcerpt[]>(doc) ?? [];
        const grouped = new Map<
          string,
          {
            namespace: string | null;
            workloadKind: string | null;
            workloadName: string | null;
            reasons: Set<string>;
            pods: Set<string>;
            samples: KubernetesUnhealthyWorkloadLogExcerpt[];
            excerptCount: number;
          }
        >();

        for (const excerpt of excerpts) {
          const workloadKey = [
            excerpt.namespace?.trim() || "",
            excerpt.workload_kind?.trim() || "",
            excerpt.workload_name?.trim() || "",
          ].join(":");
          const bucket =
            grouped.get(workloadKey) ??
            {
              namespace: excerpt.namespace?.trim() || null,
              workloadKind: excerpt.workload_kind?.trim() || null,
              workloadName: excerpt.workload_name?.trim() || null,
              reasons: new Set<string>(),
              pods: new Set<string>(),
              samples: [],
              excerptCount: 0,
            };

          if (excerpt.reason?.trim()) bucket.reasons.add(excerpt.reason.trim());
          if (excerpt.pod_name?.trim()) bucket.pods.add(excerpt.pod_name.trim());
          if (
            bucket.samples.length < 2 &&
            Array.isArray(excerpt.excerpt_lines) &&
            excerpt.excerpt_lines.some((line) => typeof line === "string" && line.trim())
          ) {
            bucket.samples.push(excerpt);
          }
          bucket.excerptCount += 1;
          grouped.set(workloadKey, bucket);
        }

        for (const bucket of grouped.values()) {
          const label = workloadLabel(bucket.namespace ?? undefined, bucket.workloadName ?? undefined);
          findings.push({
            title: `Kubernetes unhealthy workload logs captured: ${label}`,
            severity_hint: "medium",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify({
              namespace: bucket.namespace,
              workload_kind: bucket.workloadKind,
              workload_name: bucket.workloadName,
              excerpt_count: bucket.excerptCount,
              reasons: Array.from(bucket.reasons).sort(),
              pods: Array.from(bucket.pods).sort(),
              samples: bucket.samples,
            }),
            rule_id: "kubernetes.unhealthy_workload_logs",
          });
        }
      }

      if (doc.kind === "horizontal-pod-autoscalers") {
        const hpas =
          parseKubernetesDocumentJson<KubernetesHorizontalPodAutoscaler[]>(doc) ?? [];
        for (const hpa of hpas) {
          const namespace = hpa.namespace?.trim();
          const name = hpa.name?.trim() || "unknown-hpa";
          const label = namespace ? `${namespace}/${name}` : name;
          const currentReplicas = hpa.current_replicas ?? 0;
          const desiredReplicas = hpa.desired_replicas ?? 0;
          const maxReplicas = hpa.max_replicas ?? 0;
          const currentCpu = hpa.current_cpu_utilization_percentage ?? null;
          const targetCpu = hpa.target_cpu_utilization_percentage ?? null;
          const conditions = hpa.conditions ?? [];
          const scalingActiveFalse = conditions.find(
            (condition) =>
              condition.type?.trim() === "ScalingActive" && !isTrueStatus(condition.status)
          );
          const ableToScaleFalse = conditions.find(
            (condition) =>
              condition.type?.trim() === "AbleToScale" && !isTrueStatus(condition.status)
          );

          if (
            maxReplicas > 0 &&
            desiredReplicas >= maxReplicas &&
            currentReplicas >= maxReplicas
          ) {
            findings.push({
              title: `Kubernetes HPA is saturated at max replicas: ${label}`,
              severity_hint:
                currentCpu !== null && targetCpu !== null && currentCpu > targetCpu
                  ? "high"
                  : "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(hpa),
              rule_id: "kubernetes.hpa_saturated",
            });
          }

          const blockedCondition = scalingActiveFalse ?? ableToScaleFalse;
          if (blockedCondition) {
            const targetKind = hpa.scale_target_kind?.trim() || "Workload";
            const targetName = hpa.scale_target_name?.trim() || "unknown-target";
            findings.push({
              title: `Kubernetes HPA cannot compute a healthy scaling recommendation: ${label} (${targetKind} ${targetName})`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(hpa),
              rule_id: "kubernetes.hpa_scaling_inactive",
            });
          }
        }
      }

      if (doc.kind === "pod-disruption-budgets") {
        const budgets =
          parseKubernetesDocumentJson<KubernetesPodDisruptionBudget[]>(doc) ?? [];
        for (const budget of budgets) {
          const disruptionsAllowed = budget.disruptions_allowed ?? 0;
          const expectedPods = budget.expected_pods ?? 0;
          if (expectedPods <= 0 || disruptionsAllowed > 0) continue;

          const namespace = budget.namespace?.trim();
          const name = budget.name?.trim() || "unknown-pdb";
          const label = namespace ? `${namespace}/${name}` : name;
          findings.push({
            title: `Kubernetes PodDisruptionBudget blocks voluntary disruption: ${label}`,
            severity_hint:
              (budget.current_healthy ?? 0) < (budget.desired_healthy ?? 0) ? "high" : "medium",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify(budget),
            rule_id: "kubernetes.pdb_blocking",
          });
        }
      }

      if (doc.kind === "resource-quotas") {
        const quotas = parseKubernetesDocumentJson<KubernetesResourceQuota[]>(doc) ?? [];
        for (const quota of quotas) {
          const namespace = quota.namespace?.trim();
          const name = quota.name?.trim() || "unknown-quota";
          const label = namespace ? `${namespace}/${name}` : name;
          for (const resource of quota.resources ?? []) {
            const usedRatio = resource.used_ratio ?? null;
            if (usedRatio === null || usedRatio < 0.9) continue;
            const resourceName = resource.resource?.trim() || "unknown-resource";
            findings.push({
              title: `Kubernetes ResourceQuota is near exhaustion: ${label} (${resourceName} at ${percentLabel(usedRatio * 100)})`,
              severity_hint: usedRatio >= 0.97 ? "high" : "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                ...quota,
                resource,
              }),
              rule_id: "kubernetes.resource_quota_pressure",
            });
          }
        }
      }

      if (doc.kind === "limit-ranges") {
        const limitRanges = parseKubernetesDocumentJson<KubernetesLimitRange[]>(doc) ?? [];
        for (const limitRange of limitRanges) {
          const namespace = limitRange.namespace?.trim();
          if (!namespace) continue;

          const current = namespaceLimitRanges.get(namespace) ?? {
            hasDefaultRequests: false,
            hasDefaultLimits: false,
          };
          namespaceLimitRanges.set(namespace, {
            hasDefaultRequests:
              current.hasDefaultRequests || limitRange.has_default_requests === true,
            hasDefaultLimits:
              current.hasDefaultLimits || limitRange.has_default_limits === true,
          });
        }
      }

      if (doc.kind === "persistent-volume-claims") {
        const claims =
          parseKubernetesDocumentJson<KubernetesPersistentVolumeClaim[]>(doc) ?? [];
        for (const claim of claims) {
          const namespace = claim.namespace?.trim();
          const name = claim.name?.trim() || "unknown-claim";
          const label = namespace ? `${namespace}/${name}` : name;
          const phase = claim.phase?.trim().toLowerCase() ?? "";
          const claimKey = namespace ? `${namespace}/${name}` : null;
          const resizePending = (claim.conditions ?? []).find(
            (condition) =>
              condition.type?.trim() === "FileSystemResizePending" &&
              isTrueStatus(condition.status)
          );

          if (phase === "pending" || phase === "lost") {
            findings.push({
              title:
                phase === "lost"
                  ? `Kubernetes PersistentVolumeClaim is lost: ${label}`
                  : `Kubernetes PersistentVolumeClaim is Pending: ${label}`,
              severity_hint: phase === "lost" ? "high" : "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(claim),
              rule_id:
                phase === "lost"
                  ? "kubernetes.persistent_volume_claim_lost"
                  : "kubernetes.persistent_volume_claim_pending",
            });
            if (claimKey) pendingPersistentVolumeClaims.set(claimKey, claim);
          }

          if (resizePending) {
            findings.push({
              title: `Kubernetes PersistentVolumeClaim is waiting for filesystem resize: ${label}`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(claim),
              rule_id: "kubernetes.persistent_volume_claim_resize_pending",
            });
            if (claimKey) resizePendingPersistentVolumeClaims.set(claimKey, claim);
          }
        }
      }

      if (doc.kind === "persistent-volumes") {
        const volumes = parseKubernetesDocumentJson<KubernetesPersistentVolume[]>(doc) ?? [];
        for (const volume of volumes) {
          const name = volume.name?.trim() || "unknown-volume";
          const phase = volume.phase?.trim().toLowerCase() ?? "";
          if (!["failed", "released"].includes(phase)) continue;

          findings.push({
            title:
              phase === "failed"
                ? `Kubernetes PersistentVolume is failed: ${name}`
                : `Kubernetes PersistentVolume is released without reuse: ${name}`,
            severity_hint: phase === "failed" ? "high" : "medium",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify(volume),
            rule_id:
              phase === "failed"
                ? "kubernetes.persistent_volume_failed"
                : "kubernetes.persistent_volume_released",
          });
        }
      }

      if (doc.kind === "node-top") {
        const nodes = parseKubernetesDocumentJson<KubernetesNodeTop[]>(doc) ?? [];
        for (const node of nodes) {
          const nodeName = node.name?.trim() || "unknown-node";
          if ((node.memory_percent ?? 0) >= 90) {
            findings.push({
              title: `Kubernetes node memory usage is elevated: ${nodeName} (${percentLabel(node.memory_percent)})`,
              severity_hint: (node.memory_percent ?? 0) >= 95 ? "high" : "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(node),
              rule_id: "kubernetes.node_memory_usage",
            });
          }

          if ((node.cpu_percent ?? 0) >= 90) {
            findings.push({
              title: `Kubernetes node CPU usage is elevated: ${nodeName} (${percentLabel(node.cpu_percent)})`,
              severity_hint: (node.cpu_percent ?? 0) >= 95 ? "high" : "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(node),
              rule_id: "kubernetes.node_cpu_usage",
            });
          }
        }
      }

      if (doc.kind === "workload-rollout-status") {
        const rolloutStatuses =
          parseKubernetesDocumentJson<KubernetesWorkloadRolloutStatus[]>(doc) ?? [];
        for (const rollout of rolloutStatuses) {
          const summary = rolloutMismatchSummary(rollout);
          if (!summary) continue;

          const label = workloadLabel(rollout.namespace ?? undefined, rollout.name ?? undefined);
          const kind = rollout.kind?.trim() || "Workload";

          if (summary.controllerLag) {
            findings.push({
              title: `Kubernetes rollout controller has not observed the latest spec generation: ${kind} ${label}`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(rollout),
              rule_id: "kubernetes.rollout_generation_lag",
            });
          }

          if (!summary.hasReplicaMismatch) continue;

          findings.push({
            title: `Kubernetes rollout incomplete: ${kind} ${label} (ready ${summary.ready}/${summary.desired}, updated ${summary.updated}/${summary.desired})`,
            severity_hint:
              summary.ready === 0 || summary.unavailable >= Math.ceil(summary.desired / 2)
                ? "high"
                : "medium",
            category: "kubernetes",
            section_source: doc.path,
            evidence: JSON.stringify(rollout),
            rule_id: "kubernetes.rollout_incomplete",
          });
        }
      }

      if (doc.kind === "pod-top") {
        const pods = parseKubernetesDocumentJson<KubernetesPodTop[]>(doc) ?? [];
        for (const pod of pods) {
          if (!pod.name?.trim()) continue;
          // Keep pod top evidence available for future UI surfacing without turning
          // a one-shot usage snapshot into a finding unless a clearer threshold exists.
        }
      }

      if (doc.kind === "workload-specs") {
        const workloads = parseKubernetesDocumentJson<KubernetesWorkloadSpec[]>(doc) ?? [];
        for (const workload of workloads) {
          const label = workloadLabel(workload.namespace, workload.name);
          const podSecurityContext = workload.pod_spec?.securityContext;
          const serviceAccountName = workload.pod_spec?.serviceAccountName?.trim() || "default";
          const workloadNamespace = workload.namespace?.trim();
          if (workloadNamespace) namespacesWithWorkloads.add(workloadNamespace);
          const workloadInExposedNamespace =
            workloadNamespace !== undefined &&
            workloadNamespace.length > 0 &&
            externalServiceNamespaces.has(workloadNamespace);

          for (const claimName of persistentVolumeClaimNames(workload)) {
            const claimKey = workloadNamespace ? `${workloadNamespace}/${claimName}` : null;
            if (claimKey && pendingPersistentVolumeClaims.has(claimKey)) {
              findings.push({
                title: `Kubernetes workload depends on a Pending PersistentVolumeClaim: ${label} -> ${claimName}`,
                severity_hint: "high",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({
                  workload,
                  persistent_volume_claim: pendingPersistentVolumeClaims.get(claimKey),
                }),
                rule_id: "kubernetes.workload_pending_persistent_volume_claim",
              });
            }

            if (claimKey && resizePendingPersistentVolumeClaims.has(claimKey)) {
              findings.push({
                title: `Kubernetes workload depends on a PersistentVolumeClaim waiting for filesystem resize: ${label} -> ${claimName}`,
                severity_hint: "medium",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({
                  workload,
                  persistent_volume_claim: resizePendingPersistentVolumeClaims.get(claimKey),
                }),
                rule_id: "kubernetes.workload_persistent_volume_claim_resize_pending",
              });
            }
          }

          if (workload.pod_spec?.automountServiceAccountToken !== false) {
            findings.push({
              title: `Kubernetes workload automatically mounts service account tokens: ${label}`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(workload),
              rule_id: "kubernetes.workload_service_account_token_automount",
            });
          }

          if (
            workload.pod_spec?.automountServiceAccountToken !== false &&
            serviceAccountName === "default"
          ) {
            findings.push({
              title: `Kubernetes workload uses the default service account with token automount: ${label}`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(workload),
              rule_id: "kubernetes.workload_default_service_account_automount",
            });
          }

          if (
            workloadInExposedNamespace &&
            workload.pod_spec?.automountServiceAccountToken !== false &&
            serviceAccountName === "default"
          ) {
            findings.push({
              title: `Kubernetes externally exposed workload uses the default service account with token automount: ${label}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                externally_exposed_namespace: workloadNamespace,
                service_account: serviceAccountName,
                automount_service_account_token: true,
              }),
              rule_id: "kubernetes.exposed_workload_default_service_account_automount",
            });
          }

          const workloadServiceAccountKey = serviceAccountKey(workload.namespace, serviceAccountName);
          if (
            workloadServiceAccountKey &&
            clusterAdminServiceAccounts.has(workloadServiceAccountKey)
          ) {
            findings.push({
              title: `Kubernetes workload service account is bound to cluster-admin: ${label} (${workloadServiceAccountKey})`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                cluster_admin_binding: true,
              }),
              rule_id: "kubernetes.workload_cluster_admin_service_account",
            });
          }

          if (
            workloadInExposedNamespace &&
            workloadServiceAccountKey &&
            clusterAdminServiceAccounts.has(workloadServiceAccountKey)
          ) {
            findings.push({
              title: `Kubernetes externally exposed workload service account is bound to cluster-admin: ${label} (${workloadServiceAccountKey})`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                cluster_admin_binding: true,
                externally_exposed_namespace: workloadNamespace,
              }),
              rule_id: "kubernetes.exposed_workload_cluster_admin_service_account",
            });
          }

          const workloadRoleBindings =
            (workloadServiceAccountKey &&
              serviceAccountRoleBindings.get(workloadServiceAccountKey)) ||
            new Set<string>();
          const boundWildcardRoleCount = Array.from(workloadRoleBindings).filter((bindingRoleKey) =>
            wildcardRoleKeys.has(bindingRoleKey)
          ).length;
          const boundEscalationRoleCount = Array.from(workloadRoleBindings).filter((bindingRoleKey) =>
            escalationRoleKeys.has(bindingRoleKey)
          ).length;
          const boundNodeProxyRoleCount = Array.from(workloadRoleBindings).filter((bindingRoleKey) =>
            nodeProxyRoleKeys.has(bindingRoleKey)
          ).length;

          if (boundWildcardRoleCount > 0) {
            findings.push({
              title: `Kubernetes workload service account is bound to wildcard RBAC roles: ${label} (${boundWildcardRoleCount} roles)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                wildcard_role_binding_count: boundWildcardRoleCount,
              }),
              rule_id: "kubernetes.workload_wildcard_rbac_service_account",
            });
          }

          if (workloadInExposedNamespace && boundWildcardRoleCount > 0) {
            findings.push({
              title: `Kubernetes externally exposed workload service account is bound to wildcard RBAC roles: ${label} (${boundWildcardRoleCount} roles)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                wildcard_role_binding_count: boundWildcardRoleCount,
                externally_exposed_namespace: workloadNamespace,
              }),
              rule_id: "kubernetes.exposed_workload_wildcard_rbac_service_account",
            });
          }

          if (boundEscalationRoleCount > 0) {
            findings.push({
              title: `Kubernetes workload service account is bound to privilege-escalation RBAC roles: ${label} (${boundEscalationRoleCount} roles)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                privilege_escalation_role_binding_count: boundEscalationRoleCount,
              }),
              rule_id: "kubernetes.workload_privilege_escalation_rbac_service_account",
            });
          }

          if (workloadInExposedNamespace && boundEscalationRoleCount > 0) {
            findings.push({
              title: `Kubernetes externally exposed workload service account is bound to privilege-escalation RBAC roles: ${label} (${boundEscalationRoleCount} roles)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                privilege_escalation_role_binding_count: boundEscalationRoleCount,
                externally_exposed_namespace: workloadNamespace,
              }),
              rule_id: "kubernetes.exposed_workload_privilege_escalation_rbac_service_account",
            });
          }

          if (boundNodeProxyRoleCount > 0) {
            findings.push({
              title: `Kubernetes workload service account is bound to node proxy RBAC roles: ${label} (${boundNodeProxyRoleCount} roles)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                node_proxy_role_binding_count: boundNodeProxyRoleCount,
              }),
              rule_id: "kubernetes.workload_node_proxy_rbac_service_account",
            });
          }

          if (workloadInExposedNamespace && boundNodeProxyRoleCount > 0) {
            findings.push({
              title: `Kubernetes externally exposed workload service account is bound to node proxy RBAC roles: ${label} (${boundNodeProxyRoleCount} roles)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                service_account: workloadServiceAccountKey,
                node_proxy_role_binding_count: boundNodeProxyRoleCount,
                externally_exposed_namespace: workloadNamespace,
              }),
              rule_id: "kubernetes.exposed_workload_node_proxy_rbac_service_account",
            });
          }

          let workloadSecretEnvRefCount = 0;
          let workloadSecretEnvFromRefCount = 0;
          const workloadSecretVolumeMountCount = secretVolumeMountCount(workload);
          const workloadProjectedTokenVolumeCount = projectedServiceAccountTokenVolumeCount(workload);
          const workloadHostPathVolumeMountCount = hostPathVolumeMountCount(workload);
          const workloadAddedCapabilityCount = addedCapabilityCount(workload);
          const workloadPrivilegedInitContainerCount = privilegedInitContainerCount(workload);

          if (workload.pod_spec?.hostNetwork) {
            findings.push({
              title: `Kubernetes workload shares the host network namespace: ${label}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(workload),
              rule_id: "kubernetes.workload_host_network",
            });
          }

          if (workload.pod_spec?.hostPID) {
            findings.push({
              title: `Kubernetes workload shares the host PID namespace: ${label}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(workload),
              rule_id: "kubernetes.workload_host_pid",
            });
          }

          if (workload.pod_spec?.hostIPC) {
            findings.push({
              title: `Kubernetes workload shares the host IPC namespace: ${label}`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify(workload),
              rule_id: "kubernetes.workload_host_ipc",
            });
          }

          for (const container of workload.pod_spec?.containers ?? []) {
            const securityContext = container.securityContext ?? {};
            const combinedSeccompType =
              securityContext.seccompProfile?.type ?? podSecurityContext?.seccompProfile?.type;
            const runAsNonRoot =
              securityContext.runAsNonRoot ?? podSecurityContext?.runAsNonRoot;
            const readOnlyRootFilesystem =
              securityContext.readOnlyRootFilesystem ?? podSecurityContext?.readOnlyRootFilesystem;
            workloadSecretEnvRefCount += secretEnvRefCount(container);
            workloadSecretEnvFromRefCount += secretEnvFromRefCount(container);

            if (securityContext.privileged) {
              findings.push({
                title: `Kubernetes workload runs privileged: ${label}`,
                severity_hint: "high",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_privileged",
              });
            }

            if (securityContext.allowPrivilegeEscalation) {
              findings.push({
                title: `Kubernetes workload allows privilege escalation: ${label}`,
                severity_hint: "high",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_privilege_escalation",
              });
            }

            if (runAsNonRoot !== true) {
              findings.push({
                title: `Kubernetes workload does not enforce runAsNonRoot: ${label}`,
                severity_hint: "medium",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_run_as_non_root",
              });
            }

            if (combinedSeccompType !== "RuntimeDefault" && combinedSeccompType !== "Localhost") {
              findings.push({
                title: `Kubernetes workload is missing a RuntimeDefault seccomp profile: ${label}`,
                severity_hint: "medium",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_seccomp",
              });
            }

            if (readOnlyRootFilesystem !== true) {
              findings.push({
                title: `Kubernetes workload uses a writable root filesystem: ${label}`,
                severity_hint: "medium",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_read_only_rootfs",
              });
            }

            if (!container.livenessProbe || !container.readinessProbe) {
              findings.push({
                title: `Kubernetes workload missing liveness or readiness probes: ${label}`,
                severity_hint: "medium",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_probes",
              });
            }

            const hasRequests = hasResourceEntries(container.resources?.requests);
            const hasLimits = hasResourceEntries(container.resources?.limits);
            if (!hasRequests || !hasLimits) {
              findings.push({
                title: `Kubernetes workload missing resource requests or limits: ${label}`,
                severity_hint: "medium",
                category: "kubernetes",
                section_source: doc.path,
                evidence: JSON.stringify({ workload, container }),
                rule_id: "kubernetes.workload_resources",
              });
            }
          }

          if (workloadSecretEnvRefCount > 0) {
            findings.push({
              title: `Kubernetes workload injects Secret values into environment variables: ${label} (${workloadSecretEnvRefCount} refs)`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                secret_env_reference_count: workloadSecretEnvRefCount,
              }),
              rule_id: "kubernetes.workload_secret_env_refs",
            });
          }

          if (workloadSecretEnvFromRefCount > 0) {
            findings.push({
              title: `Kubernetes workload bulk-imports Secret data into environment variables: ${label} (${workloadSecretEnvFromRefCount} refs)`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                secret_env_from_reference_count: workloadSecretEnvFromRefCount,
              }),
              rule_id: "kubernetes.workload_secret_env_from_refs",
            });
          }

          if (workloadSecretVolumeMountCount > 0) {
            findings.push({
              title: `Kubernetes workload mounts Secret volumes: ${label} (${workloadSecretVolumeMountCount} mounts)`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                secret_volume_mount_count: workloadSecretVolumeMountCount,
              }),
              rule_id: "kubernetes.workload_secret_volume_mounts",
            });
          }

          if (workloadProjectedTokenVolumeCount > 0) {
            findings.push({
              title: `Kubernetes workload mounts projected service account token volumes: ${label} (${workloadProjectedTokenVolumeCount} mounts)`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                projected_service_account_token_volume_count: workloadProjectedTokenVolumeCount,
              }),
              rule_id: "kubernetes.workload_projected_service_account_token_volumes",
            });
          }

          if (workloadInExposedNamespace && workloadProjectedTokenVolumeCount > 0) {
            findings.push({
              title: `Kubernetes externally exposed workload mounts projected service account token volumes: ${label} (${workloadProjectedTokenVolumeCount} mounts)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                projected_service_account_token_volume_count: workloadProjectedTokenVolumeCount,
                externally_exposed_namespace: workloadNamespace,
              }),
              rule_id: "kubernetes.exposed_workload_projected_service_account_token_volumes",
            });
          }

          if (workloadHostPathVolumeMountCount > 0) {
            findings.push({
              title: `Kubernetes workload mounts hostPath volumes: ${label} (${workloadHostPathVolumeMountCount} mounts)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                host_path_volume_mount_count: workloadHostPathVolumeMountCount,
              }),
              rule_id: "kubernetes.workload_host_path_mounts",
            });
          }

          if (workloadAddedCapabilityCount > 0) {
            findings.push({
              title: `Kubernetes workload adds Linux capabilities: ${label} (${workloadAddedCapabilityCount} capabilities)`,
              severity_hint: "medium",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                added_capability_count: workloadAddedCapabilityCount,
              }),
              rule_id: "kubernetes.workload_added_capabilities",
            });
          }

          if (workloadPrivilegedInitContainerCount > 0) {
            findings.push({
              title: `Kubernetes workload uses privileged init containers: ${label} (${workloadPrivilegedInitContainerCount} containers)`,
              severity_hint: "high",
              category: "kubernetes",
              section_source: doc.path,
              evidence: JSON.stringify({
                workload,
                privileged_init_container_count: workloadPrivilegedInitContainerCount,
              }),
              rule_id: "kubernetes.workload_privileged_init_containers",
            });
          }
        }
      }
    }

    for (const namespace of Array.from(namespacesWithWorkloads).sort()) {
      const defaults = namespaceLimitRanges.get(namespace);
      const hasDefaultRequests = defaults?.hasDefaultRequests === true;
      const hasDefaultLimits = defaults?.hasDefaultLimits === true;
      if (hasDefaultRequests && hasDefaultLimits) continue;

      const missing = [
        hasDefaultRequests ? null : "default requests",
        hasDefaultLimits ? null : "default limits",
      ]
        .filter((value): value is string => value !== null)
        .join(" and ");

      findings.push({
        title: `Kubernetes namespace lacks complete LimitRange defaults: ${namespace}`,
        severity_hint: "medium",
        category: "kubernetes",
        section_source: "quotas/limit-ranges.json",
        evidence: JSON.stringify({
          namespace,
          has_default_requests: hasDefaultRequests,
          has_default_limits: hasDefaultLimits,
          missing,
        }),
        rule_id: "kubernetes.namespace_limit_range_defaults_missing",
      });
    }

    for (const namespace of externalServiceNamespaces) {
      if (namespacesWithNetworkPolicy.has(namespace)) continue;
      findings.push({
        title: `Kubernetes namespace exposed externally without NetworkPolicy isolation: ${namespace}`,
        severity_hint: "high",
        category: "kubernetes",
        section_source: "network/network-policies.json",
        evidence: JSON.stringify({ namespace, has_network_policy: false }),
        rule_id: "kubernetes.namespace_without_network_policy",
      });
    }

    return findings;
  }

  detectIncomplete(sections: Record<string, string>): { incomplete: boolean; reason?: string } {
    const manifest = manifestFromSections(sections);
    if (!manifest) {
      return {
        incomplete: true,
        reason: "Invalid kubernetes-bundle.v1 manifest",
      };
    }

    if (!manifest.cluster.name.trim()) {
      return {
        incomplete: true,
        reason: "Missing cluster.name in Kubernetes bundle manifest",
      };
    }

    if (manifest.scope.level === "namespace" && !manifest.scope.namespace?.trim()) {
      return {
        incomplete: true,
        reason: "Namespace-scoped Kubernetes bundle is missing scope.namespace",
      };
    }

    if (manifest.documents.length === 0) {
      return {
        incomplete: true,
        reason: "Kubernetes bundle contains no documents",
      };
    }

    return { incomplete: false };
  }
}
