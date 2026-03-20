import type { ArtifactAdapter } from "./types.js";
import { LinuxAuditLogAdapter } from "./linux-audit-log/index.js";

const adapters: Record<string, ArtifactAdapter> = {
  "linux-audit-log": new LinuxAuditLogAdapter(),
};

export function getAdapter(artifactType: string): ArtifactAdapter {
  const adapter = adapters[artifactType];
  if (!adapter) {
    throw new Error(
      `No adapter registered for artifact type: ${artifactType}`
    );
  }
  return adapter;
}

export function detectArtifactType(_content: string): string {
  return "linux-audit-log";
}
