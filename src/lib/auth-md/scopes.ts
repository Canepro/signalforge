/** Discovery scope vocabulary for collection execution agents (slice 1). */
export const COLLECTION_AGENT_SCOPES = [
  "source.read",
  "agent.heartbeat",
  "collection_job.poll",
  "collection_job.execute",
] as const;

export type CollectionAgentScope = (typeof COLLECTION_AGENT_SCOPES)[number];

/**
 * Discovery scope vocabulary for automation agents (e.g. automation agent).
 * Metadata only until route-level enforcement is proven compatible with capability gates.
 */
export const AUTOMATION_AGENT_SCOPES = [
  "source.read",
  "automation_signal.read",
  "diagnostic_request.create",
  "diagnostic_request.read",
  "fix_action.request",
] as const;

export type AutomationAgentScope = (typeof AUTOMATION_AGENT_SCOPES)[number];

/** Later-slice scopes documented in discovery but not issued in slice 1. */
export const LATER_AGENT_SCOPES = ["fix_action.execute"] as const;

const automationOnlyScopes = AUTOMATION_AGENT_SCOPES.filter(
  (scope) => !(COLLECTION_AGENT_SCOPES as readonly string[]).includes(scope)
);

export const ALL_DOCUMENTED_AGENT_SCOPES = [
  ...COLLECTION_AGENT_SCOPES,
  ...automationOnlyScopes,
  ...LATER_AGENT_SCOPES,
] as const;

/**
 * Implied runtime capability strings agents should heartbeat with for a scope bundle.
 * Scopes remain discovery metadata in slice 1; jobs/next still gates on capabilities.
 */
export function impliedCollectionCapabilities(expectedArtifactType: string): string[] {
  return [`collect:${expectedArtifactType}`, "upload:multipart"];
}

/** Documented automation-agent capabilities (runtime uses source-bound token + existing routes). */
export function impliedAutomationAgentCapabilities(): string[] {
  return [
    "automation:diagnostic_request",
    "automation:signal_poll",
    "automation:fix_action_request",
  ];
}
