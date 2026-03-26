import {
  validateCollectionScopeForArtifactType,
  type CollectionScope,
  type ContainerRuntime,
} from "@/lib/collection-scope";
import type { ArtifactType } from "@/lib/source-catalog";

type CollectionScopeParseResult =
  | { ok: true; value: CollectionScope | null }
  | { ok: false; code: "invalid_collection_scope" | "invalid_default_collection_scope" };

function readTrimmedString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseContainerRuntime(value: string | null): ContainerRuntime | undefined {
  return value === "docker" || value === "podman" ? value : undefined;
}

export function parseCollectionScopeFormData(
  formData: FormData,
  opts: {
    prefix: string;
    artifactType: ArtifactType;
    errorCode: "invalid_collection_scope" | "invalid_default_collection_scope";
  }
): CollectionScopeParseResult {
  const kind = readTrimmedString(formData, `${opts.prefix}_kind`);
  if (!kind) {
    return { ok: true, value: null };
  }

  let scope: CollectionScope | null = null;

  if (kind === "linux_host") {
    scope = { kind: "linux_host" };
  } else if (kind === "container_target") {
    const containerRef = readTrimmedString(formData, `${opts.prefix}_container_ref`);
    if (!containerRef) {
      return { ok: false, code: opts.errorCode };
    }
    scope = {
      kind: "container_target",
      container_ref: containerRef,
      runtime: parseContainerRuntime(readTrimmedString(formData, `${opts.prefix}_runtime`)),
      host_hint: readTrimmedString(formData, `${opts.prefix}_host_hint`) ?? undefined,
    };
  } else if (kind === "kubernetes_scope") {
    const scopeLevel = readTrimmedString(formData, `${opts.prefix}_scope_level`);
    const namespace = readTrimmedString(formData, `${opts.prefix}_namespace`);
    if (scopeLevel !== "cluster" && scopeLevel !== "namespace") {
      return { ok: false, code: opts.errorCode };
    }
    if (scopeLevel === "namespace" && !namespace) {
      return { ok: false, code: opts.errorCode };
    }
    scope = {
      kind: "kubernetes_scope",
      scope_level: scopeLevel,
      namespace: namespace ?? undefined,
      kubectl_context: readTrimmedString(formData, `${opts.prefix}_kubectl_context`) ?? undefined,
      cluster_name: readTrimmedString(formData, `${opts.prefix}_cluster_name`) ?? undefined,
      provider: readTrimmedString(formData, `${opts.prefix}_provider`) ?? undefined,
    };
  } else {
    return { ok: false, code: opts.errorCode };
  }

  const validation = validateCollectionScopeForArtifactType(scope, opts.artifactType);
  if (!validation.ok) {
    return { ok: false, code: opts.errorCode };
  }

  return { ok: true, value: scope };
}
