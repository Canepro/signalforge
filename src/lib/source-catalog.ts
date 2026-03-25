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
