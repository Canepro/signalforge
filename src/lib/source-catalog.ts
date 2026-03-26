export const SOURCE_TYPE_OPTIONS = [
  {
    value: "linux_host",
    label: "Linux host",
    description: "A standard Linux machine running the external collector or agent.",
  },
  {
    value: "wsl",
    label: "WSL",
    description: "A Windows Subsystem for Linux environment producing Linux audit output.",
  },
] as const;

export type SourceType = (typeof SOURCE_TYPE_OPTIONS)[number]["value"];

export const ARTIFACT_TYPE_OPTIONS = [
  {
    value: "linux-audit-log",
    label: "Linux audit log",
    description: "first-audit.sh output or equivalent Linux diagnostics text.",
  },
  {
    value: "container-diagnostics",
    label: "Container diagnostics",
    description: "Structured text diagnostics for a single container or containerized workload.",
  },
  {
    value: "kubernetes-bundle",
    label: "Kubernetes bundle",
    description: "UTF-8 JSON manifest carrying named Kubernetes evidence documents.",
  },
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPE_OPTIONS)[number]["value"];

export type ArtifactFamilyPresentation = {
  value: ArtifactType;
  label: string;
  description: string;
  uploadShape: string;
  targetIdentifierHint: string;
  targetIdentifierExample: string;
  recommendedCollection: string;
  jobDrivenStatus: string;
};

const ARTIFACT_FAMILY_PRESENTATIONS: ArtifactFamilyPresentation[] = [
  {
    value: "linux-audit-log",
    label: "Linux audit log",
    description: "Host-level audit output from first-audit.sh or an equivalent Linux evidence collector.",
    uploadShape: "Plain text .log or .txt artifact",
    targetIdentifierHint: "Use a stable host identifier so compare can line up repeated audits.",
    targetIdentifierExample: "host:prod-web-01",
    recommendedCollection: "Push directly or use a long-running host agent service.",
    jobDrivenStatus: "Best-supported end-to-end job-driven family today.",
  },
  {
    value: "container-diagnostics",
    label: "Container diagnostics",
    description: "Runtime posture for one container or workload, including ports, mounts, privileges, and identity signals.",
    uploadShape: "Structured .txt, .log, or .json artifact for one container target",
    targetIdentifierHint:
      "Use a stable workload identifier, not an ephemeral container id, when you want compare to track the same service over time.",
    targetIdentifierExample: "container-workload:host-a:podman:payments-api",
    recommendedCollection:
      "Push from a prepared runtime-adjacent helper, or use a host agent pinned to one container target.",
    jobDrivenStatus:
      "Host-agent path exists, but target selection still lives in host-local collector environment.",
  },
  {
    value: "kubernetes-bundle",
    label: "Kubernetes bundle",
    description: "Normalized UTF-8 JSON manifest containing Kubernetes workload, exposure, RBAC, and status evidence.",
    uploadShape: "kubernetes-bundle.v1 JSON manifest",
    targetIdentifierHint:
      "Use a cluster or cluster-plus-namespace identifier so compare stays stable as workload objects churn.",
    targetIdentifierExample: "cluster:prod-eu-1:namespace:payments",
    recommendedCollection:
      "Push from a workstation, CI runner, or helper with kubectl access, or use a prepared host agent with the intended context.",
    jobDrivenStatus:
      "Host-agent path exists, but scope and kubectl context are still process-local rather than job-scoped.",
  },
] as const;

export const COLLECTION_STACK_ROLES = [
  {
    id: "signalforge",
    label: "signalforge",
    role: "Control plane",
    description: "Stores artifacts, runs analysis, compare, APIs, and the operator UI.",
  },
  {
    id: "signalforge-collectors",
    label: "signalforge-collectors",
    role: "Collector implementations",
    description: "Produces Linux, container, and Kubernetes artifacts and can push them directly.",
  },
  {
    id: "signalforge-agent",
    label: "signalforge-agent",
    role: "Execution-plane helper",
    description: "Heartbeats, polls for jobs, runs collectors locally, and uploads artifacts back to SignalForge.",
  },
] as const;

export const DEFAULT_SOURCE_TYPE: SourceType = "linux_host";
export const DEFAULT_EXPECTED_ARTIFACT_TYPE: ArtifactType = "linux-audit-log";

export function isSourceType(value: string | null | undefined): value is SourceType {
  return SOURCE_TYPE_OPTIONS.some((option) => option.value === value);
}

export function isCatalogArtifactType(
  value: string | null | undefined
): value is ArtifactType {
  return ARTIFACT_TYPE_OPTIONS.some((option) => option.value === value);
}

export function listSourceTypeOptions() {
  return SOURCE_TYPE_OPTIONS;
}

export function listArtifactTypeOptions() {
  return ARTIFACT_TYPE_OPTIONS;
}

export function listArtifactFamilyPresentations(): ArtifactFamilyPresentation[] {
  return [...ARTIFACT_FAMILY_PRESENTATIONS];
}

export function getArtifactFamilyPresentation(
  artifactType: string
): ArtifactFamilyPresentation | null {
  return ARTIFACT_FAMILY_PRESENTATIONS.find((option) => option.value === artifactType) ?? null;
}

export function getSourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_OPTIONS.find((option) => option.value === sourceType)?.label ?? sourceType;
}

export function getArtifactTypeLabel(artifactType: string): string {
  return (
    ARTIFACT_TYPE_OPTIONS.find((option) => option.value === artifactType)?.label ?? artifactType
  );
}

/** e.g. `linux-audit-log` -> `collect:linux-audit-log` */
export function collectCapabilityForArtifactType(artifactType: string): string {
  return `collect:${artifactType}`;
}

export function defaultCapabilitiesForArtifactType(artifactType: string): string[] {
  const trimmed = artifactType.trim();
  return trimmed ? [collectCapabilityForArtifactType(trimmed)] : [];
}
