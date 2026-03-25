import type { ArtifactAdapter } from "./types";
import { LinuxAuditLogAdapter } from "./linux-audit-log/index";
import {
  DEFAULT_EXPECTED_ARTIFACT_TYPE,
  isCatalogArtifactType,
  type ArtifactType,
  listArtifactTypeOptions,
} from "../source-catalog";

const adapters: Record<ArtifactType, ArtifactAdapter> = {
  "linux-audit-log": new LinuxAuditLogAdapter(),
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

export function detectArtifactType(_content: string): ArtifactType {
  return DEFAULT_EXPECTED_ARTIFACT_TYPE;
}
