import type { ArtifactAdapter } from "./types";
import { ContainerDiagnosticsAdapter } from "./container-diagnostics/index";
import { LinuxAuditLogAdapter } from "./linux-audit-log/index";
import {
  DEFAULT_EXPECTED_ARTIFACT_TYPE,
  isCatalogArtifactType,
  type ArtifactType,
  listArtifactTypeOptions,
} from "../source-catalog";

const adapters: Record<ArtifactType, ArtifactAdapter> = {
  "linux-audit-log": new LinuxAuditLogAdapter(),
  "container-diagnostics": new ContainerDiagnosticsAdapter(),
};

export class UnsupportedArtifactTypeError extends Error {
  readonly code = "unsupported_artifact_type";
  readonly artifactType: string;

  constructor(artifactType: string) {
    super(`Unsupported artifact type: ${artifactType}`);
    this.name = "UnsupportedArtifactTypeError";
    this.artifactType = artifactType;
  }
}

export function isSupportedArtifactType(
  artifactType: string | null | undefined
): artifactType is ArtifactType {
  return isCatalogArtifactType(artifactType);
}

export function listSupportedArtifactTypes(): ArtifactType[] {
  return listArtifactTypeOptions().map((option) => option.value);
}

export function getAdapter(artifactType: string): ArtifactAdapter {
  if (!isSupportedArtifactType(artifactType)) {
    throw new UnsupportedArtifactTypeError(artifactType);
  }
  return adapters[artifactType];
}

export function detectArtifactType(content: string): ArtifactType {
  if (
    /^===\s*container-diagnostics\s*===/im.test(content) ||
    (/^container_name:/im.test(content) && /^runtime:/im.test(content))
  ) {
    return "container-diagnostics";
  }
  return DEFAULT_EXPECTED_ARTIFACT_TYPE;
}
