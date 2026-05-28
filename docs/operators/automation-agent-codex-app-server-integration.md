# Automation Agent and Codex App Server Integration

SignalForge keeps three roles separate:

| Role | Purpose | Credential / runtime |
| --- | --- | --- |
| **Analysis brain** | One explanation pass over deterministic pre-findings | `LLM_PROVIDER=codex_app_server` uses local stdio or an authenticated WebSocket Codex App Server |
| **Automation agent** | External operator client: signals, diagnostic requests, fix-action requests | Source-bound token, such as `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>` in Infisical |
| **Execution agent** | Collection jobs and approved safe-fix apply | `signalforge-agent` source token |

Do not collapse the automation agent into Codex App Server. The automation
agent never replaces the analysis brain, and Codex App Server never replaces a
source-bound automation-agent token.

## Codex App Server (analysis brain only)

When `LLM_PROVIDER=codex_app_server`, SignalForge:

1. Runs the deterministic adapter pipeline first (pre-findings, noise, incomplete detection).
2. Starts an **ephemeral** Codex thread per analysis over stdio (`codex app-server` by default) or an authenticated WebSocket transport.
3. Sends a single `turn/start` with `outputSchema` matching `AuditReportSchema`, `sandboxPolicy: { type: "readOnly", networkAccess: false }`, and `approvalPolicy: "never"`.
4. Parses strict JSON from the turn result; on failure, uses the same deterministic fallback as OpenAI/Azure misconfiguration.

SignalForge does **not** expose Codex shell/file tools for analysis. If your app-server build cannot honor read-only turns, do not enable this provider until it can.

WebSocket transport is opt-in. Loopback URLs are allowed with a token file or
bearer token. Non-loopback URLs require `CODEX_APP_SERVER_WS_ALLOW_REMOTE=true`
and must be authenticated private/tunnel endpoints. Do not expose an
unauthenticated Codex App Server listener.

### Environment

| Variable | Default | Description |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | Set to `codex_app_server` to use Codex App Server for the analysis explanation pass |
| `CODEX_APP_SERVER_TRANSPORT` | `stdio` | `stdio` or `websocket` |
| `CODEX_APP_SERVER_COMMAND` | `codex app-server` | Command used to start the local app-server process |
| `CODEX_APP_SERVER_MODEL` | `gpt-5.4` | Model id passed to Codex App Server |
| `CODEX_APP_SERVER_TURN_TIMEOUT_MS` | `120000` | Per-analysis wait before deterministic fallback |
| `CODEX_APP_SERVER_WS_URL` | unset | Loopback WebSocket URL when testing websocket config |
| `CODEX_APP_SERVER_WS_ALLOW_REMOTE` | unset | Set to `true` only for authenticated private/tunnel WebSocket endpoints |
| `CODEX_APP_SERVER_WS_BEARER_TOKEN` | unset | Bearer token injected by the runtime secret store for WebSocket auth |
| `CODEX_APP_SERVER_WS_TOKEN_FILE` | unset | Capability-token file for websocket config |
| `CODEX_APP_SERVER_WS_SHARED_SECRET_FILE` | unset | Signed-bearer shared-secret file for websocket config |

Use the fixture check when validating a local Codex App Server setup:

```bash
bun run verify:codex-brain
```

The fixture check does not inspect the current machine. Older Linux/WSL fixture names are historical artifact samples from prior development, not a claim about the operator's workstation.

See [Codex App Server](https://developers.openai.com/codex/app-server) for upstream app-server behavior.

## ACA Production Notes

The ACA app cannot use stdio unless the container image contains Codex CLI plus
a valid Codex auth session, which is not the current production shape. For ACA,
use `LLM_PROVIDER=codex_app_server` only with:

- `CODEX_APP_SERVER_TRANSPORT=websocket`
- `CODEX_APP_SERVER_WS_URL=<authenticated private/tunnel endpoint>`
- `CODEX_APP_SERVER_WS_ALLOW_REMOTE=true`
- `CODEX_APP_SERVER_WS_BEARER_TOKEN=<from Infisical or ACA secret>`

The deployed app health endpoint reports the selected provider, transport, and
model, but never prints the bearer token.

## Automation Agent

An external operator agent uses the existing automation-agent HTTP surface:

- `POST /api/automation-agent/registrations` (operator admin Bearer at enroll time)
- `GET /api/automation-agent/signals/next`
- `POST /api/automation-agent/diagnostic-requests`
- `GET /api/automation-agent/diagnostic-requests/[id]`
- Fix-action request APIs when enabled on the Source

Discovery scopes are published in `GET /auth.md` and well-known metadata
(metadata only in this slice; routes still use existing capability gates):

- `source.read`
- `automation_signal.read`
- `diagnostic_request.create`
- `diagnostic_request.read`
- `fix_action.request`

Store issued tokens in Infisical or an equivalent secret manager. Prefer one
source-bound token per Source, using
`SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>`. Do not commit or log
plaintext tokens.

Enrollment helper:

```bash
export SIGNALFORGE_BASE_URL=https://your-signalforge-host
export SIGNALFORGE_ADMIN_TOKEN=<from-infisical>
./scripts/signalforge-automation-agent.sh register <source-id> --display-name operator-agent --print-exports
```

See [`automation-agent-integration.md`](./automation-agent-integration.md) for the full HTTP contract.

## Infisical

Infisical owns runtime secrets for deploy and local dev. Use `infisical run --`
to inject analysis settings and automation-agent tokens without placing them in
the repo.

## Out of scope

- OTP/email production auth
- ID-JAG issuer trust
- Admin scopes on agent tokens
- Codex App Server or the automation agent running collection, `kubectl`, or arbitrary remediation inside SignalForge
