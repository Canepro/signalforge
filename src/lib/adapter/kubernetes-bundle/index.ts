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

type KubernetesWorkloadStatus = {
  namespace?: string;
  name?: string;
  status?: string;
  restarts?: number;
};

function manifestFromSections(sections: Record<string, string>): KubernetesBundleManifest | null {
  return parseKubernetesBundle(sections[MANIFEST_KEY] ?? "");
}

function workloadLabel(namespace: string | undefined, name: string | undefined): string {
  if (namespace && name) return `${namespace}/${name}`;
  return name || namespace || "unknown-workload";
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

    for (const doc of manifest.documents) {
      if (doc.kind === "service-exposure") {
        const services = parseKubernetesDocumentJson<KubernetesServiceExposure[]>(doc) ?? [];
        for (const service of services) {
          const serviceType = service.type?.trim();
          const isExternal = service.external === true || serviceType === "LoadBalancer";
          if (!isExternal) continue;
          const label = workloadLabel(service.namespace, service.name);
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
