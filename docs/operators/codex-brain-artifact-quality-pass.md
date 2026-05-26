# Codex App Server Brain — Artifact Quality Pass

Date: 2026-05-26  
Scope: SignalForge analysis brain (`LLM_PROVIDER=codex_app_server`) on mandatory fixtures.

## What was checked

| Fixture | Deterministic pre-findings | Codex brain expectations |
|---------|---------------------------|---------------------------|
| `sample-prod-server.log` | Network listeners 80/443 (medium) | Summary/actions name HTTP/HTTPS exposure; no invented findings |
| `wsl-mar2026-full.log` | Disk, packages, auth, logs | Disk/auth prioritized in `top_actions_now`; WSL noise stays in `noise_or_expected` |
| `container-database-service.txt` | Container isolation/hardening | Container/workload wording; no generic host-admin language |
| `kubernetes-payments-bundle.json` | Exposure, RBAC, rollout, node pressure | Cluster/namespace terms; operational pressure ranked in actions |
| `kubernetes-public-ingress-namespace.json` | Ingress exposure, isolation gaps | Namespace-scoped wording; no payment-scenario bleed |

## Live smoke (operator workstation)

When `codex app-server` is available:

```bash
export LLM_PROVIDER=codex_app_server
export CODEX_APP_SERVER_COMMAND="codex app-server"
export CODEX_APP_SERVER_MODEL=gpt-5.4

bun run smoke:codex-brain
bash scripts/smoke-codex-brain-fixture-suite.sh
```

Observed on a live workstation (pre-PR #22 fail-closed fix):

- `wsl-nov2025-truncated.log`: `llm_succeeded: true`, empty findings (incomplete fixture)
- `sample-prod-server.log`: `llm_succeeded: true`, two medium network findings preserved

## Tuning applied (this pass)

- Strengthened Kubernetes operational guidance in `buildSystemPrompt` / `buildUserPrompt` so Codex prioritizes high-impact cluster actions without inventing findings or changing severities.
- No deterministic rule or severity changes were required for the five mandatory fixtures after golden review.

## Deferred

- **Selene automation-agent E2E** on live ACA remains blocked until production Postgres has `sources.automation_enabled` (migration drift).
- **WebSocket Codex transport** remains unimplemented in SignalForge; stdio is the supported path.
- Full live suite on CI agents without Codex CLI installed is intentionally skipped (`smoke:codex-brain` exits 0 when `codex` is missing).

## Validation commands

```bash
bun run typecheck
bun run test tests/analyzer
bun run build
bun run smoke:codex-brain   # optional; requires local codex CLI
```
