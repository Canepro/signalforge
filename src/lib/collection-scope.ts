export type ContainerRuntime = "docker" | "podman";

export type LinuxHostCollectionScope = { kind: "linux_host" };

export type ContainerTargetCollectionScope = {
  kind: "container_target";
  runtime?: ContainerRuntime;
  container_ref: string;
  host_hint?: string;
};

export type KubernetesScopeCollectionScope = {
  kind: "kubernetes_scope";
  scope_level: "cluster" | "namespace";
  namespace?: string;
  kubectl_context?: string;
  cluster_name?: string;
  provider?: string;
};

export type CollectionScope =
  | LinuxHostCollectionScope
  | ContainerTargetCollectionScope
  | KubernetesScopeCollectionScope;

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function parseCollectionScopeJson(raw: string | null | undefined): CollectionScope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isCollectionScope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isCollectionScope(input: unknown): input is CollectionScope {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;

  if (value.kind === "linux_host") {
    if (!hasOnlyKeys(value, ["kind"])) return false;
    return true;
  }

  if (value.kind === "container_target") {
    if (!hasOnlyKeys(value, ["kind", "runtime", "container_ref", "host_hint"])) return false;
    if (typeof value.container_ref !== "string" || !value.container_ref.trim()) return false;
    if (
      value.runtime !== undefined &&
      value.runtime !== "docker" &&
      value.runtime !== "podman"
    ) {
      return false;
    }
    if (value.host_hint !== undefined && typeof value.host_hint !== "string") return false;
    return true;
  }

  if (value.kind === "kubernetes_scope") {
    if (
      !hasOnlyKeys(value, [
        "kind",
        "scope_level",
        "namespace",
        "kubectl_context",
        "cluster_name",
        "provider",
      ])
    ) {
      return false;
    }
    if (value.scope_level !== "cluster" && value.scope_level !== "namespace") return false;
    if (value.namespace !== undefined) {
      if (typeof value.namespace !== "string" || !value.namespace.trim()) return false;
    }
    if (value.kubectl_context !== undefined && typeof value.kubectl_context !== "string") {
      return false;
    }
    if (value.cluster_name !== undefined && typeof value.cluster_name !== "string") return false;
    if (value.provider !== undefined && typeof value.provider !== "string") return false;
    if (value.scope_level === "namespace" && (!value.namespace || !value.namespace.trim())) {
      return false;
    }
    return true;
  }

  return false;
}

export function validateCollectionScopeForArtifactType(
  scope: CollectionScope | null,
  artifactType: string
): { ok: true } | { ok: false; error: string } {
  if (!scope) return { ok: true };

  if (artifactType === "linux-audit-log") {
    return scope.kind === "linux_host" ?
        { ok: true }
      : { ok: false, error: "linux-audit-log jobs require collection_scope.kind=linux_host" };
  }
  if (artifactType === "container-diagnostics") {
    return scope.kind === "container_target" ?
        { ok: true }
      : {
          ok: false,
          error: "container-diagnostics jobs require collection_scope.kind=container_target",
        };
  }
  if (artifactType === "kubernetes-bundle") {
    return scope.kind === "kubernetes_scope" ?
        { ok: true }
      : {
          ok: false,
          error: "kubernetes-bundle jobs require collection_scope.kind=kubernetes_scope",
        };
  }
  return { ok: false, error: `Unsupported artifact type for collection_scope: ${artifactType}` };
}
