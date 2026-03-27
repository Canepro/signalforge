export interface KubernetesBundleDocument {
  path: string;
  kind: string;
  media_type: string;
  content: string;
}

export interface KubernetesNodeHealth {
  name?: string;
  ready?: boolean;
  unschedulable?: boolean;
  pressure_conditions?: string[];
}

export interface KubernetesWarningEvent {
  namespace?: string | null;
  involved_kind?: string | null;
  involved_name?: string | null;
  reason?: string | null;
  message?: string | null;
  count?: number | null;
  last_timestamp?: string | null;
}

export interface KubernetesWorkloadRolloutStatus {
  namespace?: string | null;
  name?: string | null;
  kind?: string | null;
  desired_replicas?: number | null;
  ready_replicas?: number | null;
  available_replicas?: number | null;
  updated_replicas?: number | null;
  unavailable_replicas?: number | null;
  generation?: number | null;
  observed_generation?: number | null;
}

export interface KubernetesHpaCondition {
  type?: string | null;
  status?: string | null;
  reason?: string | null;
  message?: string | null;
}

export interface KubernetesHorizontalPodAutoscaler {
  namespace?: string | null;
  name?: string | null;
  scale_target_kind?: string | null;
  scale_target_name?: string | null;
  min_replicas?: number | null;
  max_replicas?: number | null;
  current_replicas?: number | null;
  desired_replicas?: number | null;
  current_cpu_utilization_percentage?: number | null;
  target_cpu_utilization_percentage?: number | null;
  conditions?: KubernetesHpaCondition[] | null;
}

export interface KubernetesPodDisruptionBudget {
  namespace?: string | null;
  name?: string | null;
  min_available?: string | null;
  max_unavailable?: string | null;
  current_healthy?: number | null;
  desired_healthy?: number | null;
  disruptions_allowed?: number | null;
  expected_pods?: number | null;
}

export interface KubernetesResourceQuotaResource {
  resource?: string | null;
  hard?: string | null;
  used?: string | null;
  used_ratio?: number | null;
}

export interface KubernetesResourceQuota {
  namespace?: string | null;
  name?: string | null;
  resources?: KubernetesResourceQuotaResource[] | null;
}

export interface KubernetesLimitRange {
  namespace?: string | null;
  name?: string | null;
  has_default_requests?: boolean | null;
  has_default_limits?: boolean | null;
}

export interface KubernetesPersistentVolumeClaimCondition {
  type?: string | null;
  status?: string | null;
  reason?: string | null;
  message?: string | null;
}

export interface KubernetesPersistentVolumeClaim {
  namespace?: string | null;
  name?: string | null;
  phase?: string | null;
  volume_name?: string | null;
  storage_class_name?: string | null;
  access_modes?: string[] | null;
  requested_storage?: string | null;
  capacity_storage?: string | null;
  conditions?: KubernetesPersistentVolumeClaimCondition[] | null;
}

export interface KubernetesPersistentVolume {
  name?: string | null;
  phase?: string | null;
  storage_class_name?: string | null;
  reclaim_policy?: string | null;
  claim_namespace?: string | null;
  claim_name?: string | null;
  access_modes?: string[] | null;
  capacity_storage?: string | null;
  reason?: string | null;
  message?: string | null;
}

export interface KubernetesPodTop {
  namespace?: string | null;
  name?: string | null;
  cpu?: string | null;
  memory?: string | null;
}

export interface KubernetesNodeTop {
  name?: string | null;
  cpu?: string | null;
  cpu_percent?: number | null;
  memory?: string | null;
  memory_percent?: number | null;
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
