/** Discovery scope vocabulary for collection execution agents (slice 1). */
export const COLLECTION_AGENT_SCOPES = [
  "source.read",
  "agent.heartbeat",
  "collection_job.poll",
  "collection_job.execute",
] as const;

export type CollectionAgentScope = (typeof COLLECTION_AGENT_SCOPES)[number];

/** Later-slice scopes documented in discovery but not issued in slice 1. */
export const LATER_AGENT_SCOPES = [
  "automation_signal.read",
  "fix_action.execute",
] as const;

export const ALL_DOCUMENTED_AGENT_SCOPES = [
  ...COLLECTION_AGENT_SCOPES,
  ...LATER_AGENT_SCOPES,
] as const;

/**
 * Implied runtime capability strings agents should heartbeat with for a scope bundle.
 * Scopes remain discovery metadata in slice 1; jobs/next still gates on capabilities.
 */
export function impliedCollectionCapabilities(expectedArtifactType: string): string[] {
  return [`collect:${expectedArtifactType}`, "upload:multipart"];
}
