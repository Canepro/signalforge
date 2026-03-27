"use client";

import { useEffect, useId, useState } from "react";
import type { CollectionScope } from "@/lib/collection-scope";
import type { ArtifactType } from "@/lib/source-catalog";

type CollectionScopeFieldsProps = {
  artifactType: ArtifactType;
  prefix: string;
  initialScope?: CollectionScope | null;
  emptyLabel: string;
  caption?: string;
};

function allowedKindForArtifactType(artifactType: ArtifactType): CollectionScope["kind"] {
  if (artifactType === "linux-audit-log") return "linux_host";
  if (artifactType === "container-diagnostics") return "container_target";
  return "kubernetes_scope";
}

function kindLabel(kind: CollectionScope["kind"]): string {
  if (kind === "linux_host") return "Linux host";
  if (kind === "container_target") return "Container target";
  return "Kubernetes scope";
}

export function CollectionScopeFields({
  artifactType,
  prefix,
  initialScope = null,
  emptyLabel,
  caption,
}: CollectionScopeFieldsProps) {
  const selectId = useId();
  const allowedKind = allowedKindForArtifactType(artifactType);
  const [kind, setKind] = useState<CollectionScope["kind"] | "">(
    initialScope?.kind === allowedKind ? initialScope.kind : ""
  );

  useEffect(() => {
    setKind((current) => (current === allowedKind ? current : ""));
  }, [allowedKind]);

  return (
    <div className="space-y-4 rounded-lg border border-outline-variant/20 bg-surface-container-low px-4 py-4">
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          Collection scope
        </span>
        <select
          id={selectId}
          name={`${prefix}_kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value as CollectionScope["kind"] | "")}
          className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
        >
          <option value="">{emptyLabel}</option>
          <option value={allowedKind}>{kindLabel(allowedKind)}</option>
        </select>
        {caption ? (
          <span className="mt-1 block text-[10px] leading-snug text-on-surface-variant">{caption}</span>
        ) : null}
      </label>

      {kind === "linux_host" && (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          Store an explicit Linux host scope on this record. This keeps the job or source self-describing even though there are no extra target fields.
        </p>
      )}

      {kind === "container_target" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Container reference
            </span>
            <input
              name={`${prefix}_container_ref`}
              defaultValue={initialScope?.kind === "container_target" ? initialScope.container_ref : ""}
              placeholder="e.g. payments-api"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Runtime (optional)
            </span>
            <select
              name={`${prefix}_runtime`}
              defaultValue={initialScope?.kind === "container_target" ? initialScope.runtime ?? "" : ""}
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            >
              <option value="">Auto / not pinned</option>
              <option value="docker">Docker</option>
              <option value="podman">Podman</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Host hint (optional)
            </span>
            <input
              name={`${prefix}_host_hint`}
              defaultValue={initialScope?.kind === "container_target" ? initialScope.host_hint ?? "" : ""}
              placeholder="e.g. runtime-host-a"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
        </div>
      )}

      {kind === "kubernetes_scope" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Scope level
            </span>
            <select
              name={`${prefix}_scope_level`}
              defaultValue={initialScope?.kind === "kubernetes_scope" ? initialScope.scope_level : "namespace"}
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            >
              <option value="namespace">Namespace</option>
              <option value="cluster">Cluster</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Namespace
            </span>
            <input
              name={`${prefix}_namespace`}
              defaultValue={initialScope?.kind === "kubernetes_scope" ? initialScope.namespace ?? "" : ""}
              placeholder="Required for namespace scope"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              kubectl context (optional)
            </span>
            <input
              name={`${prefix}_kubectl_context`}
              defaultValue={initialScope?.kind === "kubernetes_scope" ? initialScope.kubectl_context ?? "" : ""}
              placeholder="e.g. prod-eu-1"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Cluster name (optional)
            </span>
            <input
              name={`${prefix}_cluster_name`}
              defaultValue={initialScope?.kind === "kubernetes_scope" ? initialScope.cluster_name ?? "" : ""}
              placeholder="e.g. prod-eu-1"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Provider (optional)
            </span>
            <input
              name={`${prefix}_provider`}
              defaultValue={initialScope?.kind === "kubernetes_scope" ? initialScope.provider ?? "" : ""}
              placeholder="e.g. aks, eks, gke"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
        </div>
      )}
    </div>
  );
}
