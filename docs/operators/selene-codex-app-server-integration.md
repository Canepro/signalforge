# Selene and Codex App Server Integration

SignalForge keeps three roles separate:

| Role | Purpose | Credential / runtime |
| --- | --- | --- |
| **Analysis brain** | One explanation pass over deterministic pre-findings | `LLM_PROVIDER=codex_app_server` spawns local `codex app-server` (stdio) |
| **Automation agent (Selene)** | Security/SRE operator client: signals, diagnostic requests, fix-action requests | Source-bound token (e.g. `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN` in Infisical) |
| **Execution agent** | Collection jobs and approved safe-fix apply | `signalforge-agent` source token |

Do not collapse Selene into Codex App Server. Selene never replaces the analysis brain, and Codex App Server never replaces Selene's automation-agent token.

## Codex App Server (analysis brain only)

When `LLM_PROVIDER=codex_app_server`, SignalForge:

1. Runs the deterministic adapter pipeline first (pre-findings, noise, incomplete detection).
2. Starts an **ephemeral** Codex thread per analysis over stdio (`codex app-server` by default).
3. Sends a single `turn/start` with `outputSchema` matching `AuditReportSchema`, `sandboxPolicy: { type: "readOnly", networkAccess: false }`, and `approvalPolicy: "never"`.
4. Parses strict JSON from the turn result; on failure, uses the same deterministic fallback as OpenAI/Azure misconfiguration.

SignalForge does **not** expose Codex shell/file tools for analysis. If your app-server build cannot honor read-only turns, do not enable this provider until it can.

WebSocket transport is opt-in and requires loopback URLs plus token files; stdio is the supported default.

Use the fixture-based smoke when validating a Mac-local Codex App Server setup:

```bash
bun run smoke:codex-brain
```

The smoke does not inspect the current machine. Older Linux/WSL fixture names are historical artifact samples from prior development, not a claim that Vincent's current workstation is WSL.

See [Codex App Server](https://developers.openai.com/codex/app-server) and `README.md` for `CODEX_APP_SERVER_*` variables.

## Selene (automation agent)

Selene uses the existing automation-agent HTTP surface:

- `POST /api/automation-agent/registrations` (operator admin Bearer at enroll time)
- `GET /api/automation-agent/signals/next`
- `POST /api/automation-agent/diagnostic-requests`
- `GET /api/automation-agent/diagnostic-requests/[id]`
- Fix-action request APIs when enabled on the Source

Discovery scopes for Selene are published in `GET /auth.md` and well-known metadata (metadata only in this slice; routes still use existing capability gates):

- `source.read`
- `automation_signal.read`
- `diagnostic_request.create`
- `diagnostic_request.read`
- `fix_action.request`

Store Selene's issued token in Infisical (recommended name: `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN`). Do not commit or log plaintext tokens.

Enrollment helper:

```bash
export SIGNALFORGE_BASE_URL=https://your-signalforge-host
export SIGNALFORGE_ADMIN_TOKEN=<from-infisical>
./scripts/signalforge-automation-agent.sh register <source-id> --display-name selene --print-exports
```

See [`automation-agent-integration.md`](./automation-agent-integration.md) for the full HTTP contract.

## Infisical

Infisical owns runtime secrets for deploy and local dev. Use `infisical run --` to inject analysis and Selene tokens without placing them in the repo.

## Out of scope

- OTP/email production auth
- ID-JAG issuer trust
- Admin scopes on agent tokens
- Codex or Selene running collection, `kubectl`, or arbitrary remediation inside SignalForge
