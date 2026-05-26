import {
  ALL_DOCUMENTED_AGENT_SCOPES,
  AUTOMATION_AGENT_SCOPES,
  COLLECTION_AGENT_SCOPES,
  impliedAutomationAgentCapabilities,
  impliedCollectionCapabilities,
} from "./scopes";

const AUTH_MD_SKILL = "https://workos.com/auth-md/docs/auth-md";

export type DiscoveryUrls = {
  baseUrl: string;
  authMdUrl: string;
  protectedResourceUrl: string;
  authorizationServerUrl: string;
  registerUri: string;
  legacyRegisterUri: string;
  claimUri: string;
};

export function buildDiscoveryUrls(baseUrl: string): DiscoveryUrls {
  const normalized = baseUrl.replace(/\/+$/, "");
  return {
    baseUrl: normalized,
    authMdUrl: `${normalized}/auth.md`,
    protectedResourceUrl: `${normalized}/.well-known/oauth-protected-resource`,
    authorizationServerUrl: `${normalized}/.well-known/oauth-authorization-server`,
    registerUri: `${normalized}/agent/auth`,
    legacyRegisterUri: `${normalized}/api/agent/registrations`,
    claimUri: `${normalized}/agent/auth/claim`,
  };
}

export function buildProtectedResourceMetadata(urls: DiscoveryUrls) {
  return {
    resource: `${urls.baseUrl}/`,
    resource_name: "SignalForge",
    authorization_servers: [urls.baseUrl],
    scopes_supported: [...ALL_DOCUMENTED_AGENT_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export function buildAuthorizationServerMetadata(urls: DiscoveryUrls) {
  return {
    issuer: urls.baseUrl,
    agent_auth: {
      skill: AUTH_MD_SKILL,
      register_uri: urls.registerUri,
      claim_uri: urls.claimUri,
      identity_types_supported: ["anonymous"],
      anonymous: {
        credential_types_supported: ["api_key"],
        note:
          "Slice 1 requires operator Bearer proof (SIGNALFORGE_ADMIN_TOKEN) at registration time.",
      },
      compatibility: {
        legacy_register_uri: urls.legacyRegisterUri,
        automation_register_uri: `${urls.baseUrl}/api/automation-agent/registrations`,
        claim_implemented: false,
      },
      events_supported: [],
    },
    scopes_supported: [...ALL_DOCUMENTED_AGENT_SCOPES],
  };
}

export function buildAuthMarkdown(urls: DiscoveryUrls): string {
  const capabilityExample = impliedCollectionCapabilities("linux-audit-log").join(", ");
  const collectionScopeList = COLLECTION_AGENT_SCOPES.map((s) => `- \`${s}\``).join("\n");
  const automationScopeList = AUTOMATION_AGENT_SCOPES.map((s) => `- \`${s}\``).join("\n");
  const automationCapabilityExample = impliedAutomationAgentCapabilities().join(", ");

  return `# auth.md

SignalForge supports agentic registration for **collection execution agents** bound to a Source.

## Discovery

1. Read Protected Resource Metadata: \`${urls.protectedResourceUrl}\`
2. Read Authorization Server metadata: \`${urls.authorizationServerUrl}\`
3. Register with operator Bearer proof, then use the issued token on existing agent APIs.

PRM is authoritative if this file conflicts with structured metadata.

## Registration (slice 1)

Collection execution agents only. Automation-agent enrollment remains at \`${urls.baseUrl}/api/automation-agent/registrations\`.

\`\`\`http
POST ${urls.registerUri}
Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>
Content-Type: application/json

{
  "source_id": "<source-uuid>",
  "display_name": "optional-host-label"
}
\`\`\`

Compatibility alias: \`POST ${urls.legacyRegisterUri}\` (same behavior).

Duplicate enroll returns **409** \`source_already_registered\`. Rotate via Sources UI reissue or a future rotate route.

## Scopes (discovery vocabulary)

### Collection execution agents

${collectionScopeList}

Runtime jobs/next gating still uses capability strings such as \`${capabilityExample}\` on heartbeat.

### Automation agents (e.g. Selene)

Automation agents are separate from collection execution agents and from the Codex App Server analysis brain.

Enroll at \`POST ${urls.baseUrl}/api/automation-agent/registrations\` with operator Bearer proof. Store the issued token outside this repo (for example \`SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN\` in Infisical).

${automationScopeList}

Documented capability examples: \`${automationCapabilityExample}\`. Route handlers continue to use existing source-bound automation-agent capability gates until scope enforcement is added in a later slice.

## Analysis brain (Codex App Server)

SignalForge can use a local Codex App Server process for the single analysis explanation pass when \`LLM_PROVIDER=codex_app_server\`. That path does not replace automation-agent tokens and does not run collection or kubectl.

## Claim flow

Claim endpoints are documented for future use (\`${urls.claimUri}\`) and are **not implemented** in slice 1.
`;
}
