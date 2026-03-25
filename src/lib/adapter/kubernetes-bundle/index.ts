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
  seccompProfile?: {
    type?: string;
  } | null;
};

type KubernetesContainerSpec = {
  name?: string;
  securityContext?: KubernetesSecurityContext;
  readinessProbe?: unknown;
  livenessProbe?: unknown;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
};

type KubernetesPodSpec = {
  securityContext?: KubernetesSecurityContext;
  containers?: KubernetesContainerSpec[];
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

function hasResourceEntries(resources: Record<string, string> | undefined): boolean {
  return Boolean(resources && Object.keys(resources).length > 0);
}

function normalizedList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
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
          for (const container of workload.pod_spec?.containers ?? []) {
            const securityContext = container.securityContext ?? {};
            const combinedSeccompType =
              securityContext.seccompProfile?.type ?? podSecurityContext?.seccompProfile?.type;
            const runAsNonRoot =
              securityContext.runAsNonRoot ?? podSecurityContext?.runAsNonRoot;

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
