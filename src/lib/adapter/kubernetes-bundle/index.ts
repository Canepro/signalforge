import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema";
import type { ArtifactAdapter } from "../types";
import {
  parseKubernetesBundle,
  parseKubernetesDocumentJson,
  type KubernetesBundleManifest,
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
    return [];
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
          if (service.namespace) externalServiceNamespaces.add(service.namespace);
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

      if (doc.kind === "workload-specs") {
        const workloads = parseKubernetesDocumentJson<KubernetesWorkloadSpec[]>(doc) ?? [];
        for (const workload of workloads) {
          const label = workloadLabel(workload.namespace, workload.name);
          const podSecurityContext = workload.pod_spec?.securityContext;
          const serviceAccountName = workload.pod_spec?.serviceAccountName?.trim() || "default";

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
