# Phase 11: auth.md Agent Registration Spike

Status: slice 1 implemented (discovery + `/agent/auth` alias); automation-agent scope vocabulary in discovery; claim/OTP follow-ons deferred  
Created: 2026-05-26  
Amended: 2026-05-20  
Implemented slice 1: 2026-05-20  
Primary repo: `signalforge`  
Related repos: `signalforge-agent`, `pipelinehealer`  
Related services: Infisical, Codex App Server

## Purpose

Test `auth.md` as the discovery and registration layer for SignalForge agents.

The first implementation should not replace the existing Source and agent-token model. It should publish a standard discovery surface and add a compatibility registration path that can sit beside the current admin-token enrollment flow.

This is a pet-project spike, so move quickly, but keep the auth boundary boring.

## Why SignalForge First

SignalForge already has the right product shape:

- Sources are the durable target identity.
- Source-bound agent registrations already exist.
- Agent tokens are already narrow execution-plane credentials.
- Agent routes already use Bearer auth for heartbeat, jobs, claim/start/fail, and artifact upload.
- Infisical is already documented as the preferred deploy and local-development secret source.

That means `auth.md` can wrap an existing concept instead of inventing a new auth model.

## First Slice Scope

The first slice covers **collection execution-agent registration only**.

Out of scope for slice 1:

- claim / OTP / ID-JAG flows (automation-agent discovery metadata is documented in slice 1b; routes unchanged)
- admin session-cookie auth on registration routes
- scope enforcement at route level (scopes are discovery metadata only in slice 1)

Runtime authorization for collection jobs continues to use existing **capability strings** on heartbeat and jobs/next gating.

## Design Position

Use the layers this way:

| Layer | Job |
| --- | --- |
| `auth.md` | Agent discovery, registration instructions, claim flow metadata, and scope vocabulary. |
| SignalForge | Source, registration, token hash, job, artifact, analysis, and audit state. |
| `signalforge-agent` | Execution-plane client that discovers SignalForge auth and stores its issued source token locally. |
| Infisical | Bootstrap secrets, trust roots, issuer config, email/OTP provider secrets, and runtime secret injection. |
| Codex App Server | Later execution/judgment bridge for Codex-backed investigation or operator workflows. Not required for the first SignalForge auth spike. |

## First Implementation Slice

### 1. Static discovery

Add unauthenticated routes at the **site root** (auth.md convention, not under `/api`):

- `GET /auth.md`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`

Minimum content:

- service name: `SignalForge`
- resource URL
- supported agent-auth flows
- registration endpoint (`POST /agent/auth`)
- compatibility registration endpoint (`POST /api/agent/registrations`)
- supported scopes (vocabulary only in slice 1)
- note that automation-agent enrollment remains on `POST /api/automation-agent/registrations` until a follow-on slice

Keep this static or settings-derived. Do not query secrets.

### 2. Scope vocabulary

Start with the smallest SignalForge-specific scopes:

| Scope | Meaning | Slice |
| --- | --- | --- |
| `source.read` | Read the source identity and non-sensitive source metadata for the bound registration. | 1 |
| `agent.heartbeat` | Send heartbeat and capability state. | 1 |
| `collection_job.poll` | Poll for the next eligible source-bound job. | 1 |
| `collection_job.execute` | Claim, start, fail, and upload artifacts for source-bound jobs. | 1 |
| `automation_signal.read` | Read eligible automation signals for a bound source. | Later |
| `fix_action.execute` | Execute approved safe-fix actions for a bound source. | Later |

Do not add broad admin scopes in the first slice.

#### Scope ↔ capability mapping (slice 1)

Scopes are **discovery metadata** in slice 1. Runtime gating stays on existing capability strings.

| Declared scope bundle (collection agent) | Implied runtime capabilities agents should heartbeat with |
| --- | --- |
| `agent.heartbeat` + `collection_job.poll` + `collection_job.execute` | `collect:<source.expected_artifact_type>`, `upload:multipart` |

Notes:

- jobs/next still requires a successful heartbeat, non-empty capabilities, and `collect:<job.artifact_type>` in the agent∩source capability intersection
- do not persist scopes on registration rows in slice 1 unless a later slice needs enforcement
- automation/fix scopes map to separate registration and capability models in a follow-on slice (`fix:kubernetes-safe`, etc.)

### 3. Registration route

Add:

- `POST /agent/auth`

**Route relationship:** `/agent/auth` is an auth.md-conventional alias. It must delegate to the same storage path as `POST /api/agent/registrations` (shared handler or thin wrapper). Discovery documents both endpoints; behavior must stay identical.

First-pass behavior:

1. Accept a requested source identity or operator-created Source id (`source_id` in JSON body).
2. Require **admin Bearer proof only** — `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>` via the existing `requireAdminBearer` helper. Session-cookie auth from `/sources/login` is **not** in slice 1.
3. Call the existing `createRegistration` storage method (create only; no silent rotate).
4. Return a one-time plaintext token, token prefix, registration id, source id, declared scopes (metadata), and rotation guidance.

Duplicate enrollment behavior:

- if the source already has a collection-agent registration → **409** `source_already_registered` (same as today)
- rotation remains operator-initiated via Sources UI (`reissueAgentTokenForSource`) or a future admin Bearer rotate route; **not** part of slice 1

This proves the `auth.md` shape without adding email OTP or ID-JAG trust on day one.

### 4. Claim flow placeholder

Publish claim metadata in discovery, but implement it behind a feature flag later.

Planned future endpoints:

- `POST /agent/auth/claim`
- `POST /agent/auth/claim/complete`

Initial claim modes:

- local/dev OTP printed to server log only when `NODE_ENV=development`
- real email OTP only after a mail provider secret is stored in Infisical
- ID-JAG only after trusted issuer config is explicit and reviewed

## Infisical Contract

Infisical should own deploy and bootstrap secrets. SignalForge should store issued agent tokens as hashes, not plaintext.

Recommended Infisical names:

| Name | Use |
| --- | --- |
| `SIGNALFORGE_ADMIN_TOKEN` | Existing operator/admin bootstrap token. |
| `OPENAI_API_KEY` | Optional LLM provider key. |
| `AZURE_OPENAI_API_KEY` | Optional Azure OpenAI key. |
| `AUTH_MD_OTP_SIGNING_SECRET` | Future claim-token signing secret. |
| `AUTH_MD_EMAIL_PROVIDER_API_KEY` | Future OTP email provider secret. |
| `AUTH_MD_TRUSTED_ISSUERS_JSON` | Future explicit trusted issuer/JWKS config. |

Do not store issued source-bound agent tokens in Infisical by default. The app should issue them once, store a hash and safe prefix, and let the target runtime store the plaintext token in its own local secret store.

For local development:

```bash
infisical run -- bun run dev
```

For CI/deploy:

- keep using the existing Infisical OIDC path documented in `docs/infisical-secrets.md`
- inject normal runtime env vars into ACA
- avoid long-lived deploy secrets in GitHub

## signalforge-agent Follow-Up

After the app routes exist, update `signalforge-agent` to support discovery:

1. Accept `SIGNALFORGE_URL`.
2. Fetch `${SIGNALFORGE_URL}/auth.md`.
3. Fetch the well-known metadata.
4. If no token is configured, run an enrollment command that calls `/agent/auth` (admin Bearer supplied by operator at install time).
5. Store the returned token in a local token file or external secret store.
6. Continue using existing agent APIs after enrollment.

Do not make the long-running agent auto-register silently in production. Enrollment should be an explicit install/setup step.

On **409 `source_already_registered`**, the agent should fail with a clear message pointing the operator to rotate via Sources UI or a future rotate API — not retry create in a loop.

## Implementation Order

1. Add tests for static discovery routes.
2. Add `auth.md` route and both well-known routes.
3. Add scope constants/types (including scope ↔ capability mapping helpers for discovery output).
4. Add tests for `/agent/auth` using the existing `requireAdminBearer` helper.
5. Implement `/agent/auth` as a thin alias over the existing registration storage path.
6. Update `docs/api-contract.md` and add JSON schemas for discovery + registration responses.
7. Update `docs/operators/sources-and-agents.md` with discovery URL, enroll paths, and collection vs automation-agent note.
8. Document local `curl` and `infisical run` smoke steps.
9. Add a small `signalforge-agent` discovery/enroll follow-up issue or doc note.
10. Update `plans/current-plan.md` when the spike lands.

## Validation

Run the smallest meaningful checks:

```bash
bun run typecheck
bun run test tests/api
bun run build
```

If storage code changes:

```bash
bash scripts/run-postgres-parity-local.sh
```

Manual smoke:

```bash
curl -fsS http://localhost:3000/auth.md
curl -fsS http://localhost:3000/.well-known/oauth-protected-resource
curl -fsS http://localhost:3000/.well-known/oauth-authorization-server
```

Then test registration with admin Bearer and confirm:

- returned token appears only in the response
- stored token is hashed
- token prefix is safe to display
- existing agent Bearer auth still works
- `POST /api/agent/registrations` still works unchanged
- duplicate enroll returns **409** `source_already_registered`

## Stop Conditions

Stop and ask before:

- replacing existing agent tokens
- adding email OTP in production
- trusting third-party ID-JAG issuers
- changing admin login/session behavior
- adding broad admin scopes
- storing plaintext issued agent tokens in the database
- making `signalforge-agent` auto-register silently in a long-running production process
- enforcing scopes at route level before capability gating is understood for automation/fix actors

## Appendix: Future Reuse (Out of Slice 1)

### PipelineHealer Follow-Up

PipelineHealer should reuse the proven SignalForge shape after the first SignalForge slice works.

Likely PipelineHealer scopes:

| Scope | Meaning |
| --- | --- |
| `activity.read` | Read CI failure activity and non-sensitive metadata. |
| `diagnosis.write` | Submit diagnosis output. |
| `remediation.request` | Request a bounded remediation plan. |
| `handoff.create` | Create agent handoff requests. |
| `codex_thread.start` | Start or resume a Codex App Server thread for one activity. |

Keep PipelineHealer write gates in PipelineHealer. Agent auth should not bypass existing `auto_apply_remediation`, repo allowlists, PR/issue policy, or retry limits.

### Codex App Server Follow-Up

Codex App Server is not part of the first SignalForge implementation. Use it after registration is proven.

Useful later shape:

- PipelineHealer activity starts or resumes a Codex thread.
- Codex turn receives logs, diagnosis context, repo path, and policy limits.
- Approvals remain explicit for shell commands, file edits, PR creation, and workflow retries.
- The app stores the Codex thread id and streams useful events back to the UI.

SignalForge can use the same pattern later for operator investigations, but the first SignalForge slice should stay focused on agent registration.

## Source References

- WorkOS announcement: `https://workos.com/blog/agent-registration-with-auth-md`
- WorkOS app guide: `https://workos.com/auth-md/docs/apps`
- WorkOS agent-provider guide: `https://workos.com/auth-md/docs/agent-providers`
- Reference repo: `https://github.com/workos/auth.md`

- SignalForge Infisical doc: `docs/infisical-secrets.md`
- SignalForge Sources and Agents doc: `docs/operators/sources-and-agents.md`
