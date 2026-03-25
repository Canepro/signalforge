export interface KubernetesBundleDocument {
  path: string;
  kind: string;
  media_type: string;
  content: string;
}

export interface KubernetesBundleManifest {
  schema_version: "kubernetes-bundle.v1";
  cluster: {
    name: string;
    provider?: string | null;
  };
  scope: {
    level: "cluster" | "namespace";
    namespace?: string | null;
  };
  collected_at?: string | null;
  collector?: {
    type?: string | null;
    version?: string | null;
  };
  documents: KubernetesBundleDocument[];
}

export function parseKubernetesBundle(raw: string): KubernetesBundleManifest | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.schema_version !== "kubernetes-bundle.v1") return null;

    const cluster = parsed.cluster as Record<string, unknown> | undefined;
    const scope = parsed.scope as Record<string, unknown> | undefined;
    const documents = Array.isArray(parsed.documents) ? parsed.documents : [];

    return {
      schema_version: "kubernetes-bundle.v1",
      cluster: {
        name: typeof cluster?.name === "string" ? cluster.name : "",
        provider: typeof cluster?.provider === "string" ? cluster.provider : null,
      },
      scope: {
        level: scope?.level === "namespace" ? "namespace" : "cluster",
        namespace: typeof scope?.namespace === "string" ? scope.namespace : null,
      },
      collected_at: typeof parsed.collected_at === "string" ? parsed.collected_at : null,
      collector:
        parsed.collector && typeof parsed.collector === "object"
          ? {
              type:
                typeof (parsed.collector as Record<string, unknown>).type === "string"
                  ? ((parsed.collector as Record<string, unknown>).type as string)
                  : null,
              version:
                typeof (parsed.collector as Record<string, unknown>).version === "string"
                  ? ((parsed.collector as Record<string, unknown>).version as string)
                  : null,
            }
          : undefined,
      documents: documents
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const doc = entry as Record<string, unknown>;
          if (
            typeof doc.path !== "string" ||
            typeof doc.kind !== "string" ||
            typeof doc.media_type !== "string" ||
            typeof doc.content !== "string"
          ) {
            return null;
          }
          return {
            path: doc.path,
            kind: doc.kind,
            media_type: doc.media_type,
            content: doc.content,
          } satisfies KubernetesBundleDocument;
        })
        .filter((entry): entry is KubernetesBundleDocument => entry !== null),
    };
  } catch {
    return null;
  }
}

export function parseKubernetesDocumentJson<T>(doc: KubernetesBundleDocument): T | null {
  try {
    return JSON.parse(doc.content) as T;
  } catch {
    return null;
  }
}
