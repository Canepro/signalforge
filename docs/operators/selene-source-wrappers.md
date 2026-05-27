# Selene Source Wrappers

Status: Phase 12 slice 4 — wrapper contract  
Updated: 2026-05-27

This document defines the per-source wrapper contract for Selene's SignalForge
diagnostic requests. Each wrapper is a source-bound shell script that reads a
single token file, calls the SignalForge automation-agent API, and optionally
waits for a result.

For token naming and enrollment steps see
[`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md).  
For the HTTP API contract see
[`automation-agent-integration.md`](./automation-agent-integration.md).  
For the Source inventory see
[`source-inventory-map.md`](./source-inventory-map.md).

---

## Wrapper design principles

- **One wrapper per Source.** Each script is bound to exactly one
  `target_identifier`. It reads one token file and sends requests for that
  source only. There is no shared multi-source wrapper.
- **Source-bound by construction.** The token file path and source identifier
  are constants in the script header. An operator cannot accidentally pass the
  wrong `--source` flag.
- **No printed tokens.** Wrappers read the token file into an env var without
  echoing it to stdout or a shell trace. No `set -x` in production mode.
- **No-value health check.** Every wrapper supports `--health-check` to
  validate token-file presence and SignalForge reachability without triggering
  a diagnostic request.
- **Safe-fix state is explicit.** Each wrapper header documents the safe-fix
  policy for its Source. Wrappers do not trigger fix actions; they request
  diagnostic runs only.
- **Templates only in this repo.** Scripts in `examples/selene-wrappers/` are
  templates. Production wrappers live in velora-infra. Do not deploy from
  `examples/` directly.

---

## Naming convention

```
signalforge-diagnostic-<source-slug>.sh
```

where `<source-slug>` is the `target_identifier` with `:` replaced by `-`,
kept lowercase.

| target\_identifier     | wrapper name |
|------------------------|--------------|
| `oke:prod-eu1`         | `signalforge-diagnostic-oke-prod-eu1.sh` |
| `linux:hostinger-prod` | `signalforge-diagnostic-linux-hostinger-prod.sh` |
| `mac:vincent-primary`  | `signalforge-diagnostic-mac-vincent-primary.sh` |
| `aks:TODO`             | *(create when cluster name is confirmed)* |
| `container-host:TODO`  | *(create when target is confirmed)* |

---

## Per-source reference

### `oke:prod-eu1`

| field | value |
|-------|-------|
| **target\_identifier** | `oke:prod-eu1` |
| **artifact family** | `kubernetes-bundle` |
| **template script** | `examples/selene-wrappers/signalforge-diagnostic-oke-prod-eu1.sh` |
| **production script location** | `/opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-oke-prod-eu1.sh` *(target)* |
| **token file** | `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-oke-prod-eu1` *(target; see migration note)* |
| **token env var** | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN` |
| **Infisical secret** | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_OKE_PROD_EU1` |
| **safe-fix policy** | `kubernetes.disable-service-account-token-automount.v1` — source automation and auto-fix must be explicitly enabled in the app |
| **collection window** | No windowing required; the execution agent (cluster-side Deployment) is always running |
| **expected terminal states** | `submitted` (success), `failed`, `cancelled`, `expired` |
| **validation command** | `SIGNALFORGE_BASE_URL=<url> ./examples/selene-wrappers/signalforge-diagnostic-oke-prod-eu1.sh --health-check` |

**OKE token-path migration note:**

The live OKE token is currently at the legacy unsuffixed path:
```
/etc/velora-infra/selene/secrets/signalforge-automation-agent-token
```

The target per-source path is:
```
/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-oke-prod-eu1
```

Do not perform this migration in the SignalForge repo. The migration requires:
1. Writing the token to the new path on the VPS.
2. Updating the deployed wrapper in velora-infra to read the new path.
3. Confirming the live Selene path still works.
4. Removing the legacy unsuffixed file only after step 3 is confirmed.

Until the migration is done, set `SIGNALFORGE_SELENE_TOKEN_FILE` to the legacy
path when running the template. The production deployed wrapper in velora-infra
retains its current behavior until explicitly updated.

---

### `linux:hostinger-prod`

| field | value |
|-------|-------|
| **target\_identifier** | `linux:hostinger-prod` |
| **artifact family** | `linux-audit-log` |
| **template script** | `examples/selene-wrappers/signalforge-diagnostic-linux-hostinger-prod.sh` |
| **production script location** | `/opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-linux-hostinger-prod.sh` *(target)* |
| **token file** | `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod` |
| **token env var** | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN` |
| **Infisical secret** | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_LINUX_HOSTINGER_PROD` |
| **safe-fix policy** | none |
| **collection window** | Confirm `signalforge-agent` is running and heartbeating on the VPS before requesting. A request with no available execution agent will remain pending until the job expires. |
| **expected terminal states** | `submitted` (success), `failed`, `cancelled`, `expired` |
| **validation command** | `SIGNALFORGE_BASE_URL=<url> ./examples/selene-wrappers/signalforge-diagnostic-linux-hostinger-prod.sh --health-check` |

---

### `mac:vincent-primary`

| field | value |
|-------|-------|
| **target\_identifier** | `mac:vincent-primary` |
| **artifact family** | `linux-audit-log` (interim; pending `mac-diagnostics` family decision) |
| **template script** | `examples/selene-wrappers/signalforge-diagnostic-mac-vincent-primary.sh` |
| **production script location** | Local workstation path; not deployed to velora-infra |
| **token file** | `~/.config/signalforge/selene-automation-agent-token-mac-vincent-primary` |
| **token env var** | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN` |
| **Infisical secret** | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_MAC_VINCENT_PRIMARY` *(add when enrolled)* |
| **safe-fix policy** | none |
| **collection window** | Confirm `signalforge-agent` service is running locally before requesting |
| **expected terminal states** | `submitted` (success), `failed`, `cancelled`, `expired` |
| **validation command** | `SIGNALFORGE_BASE_URL=<url> ./examples/selene-wrappers/signalforge-diagnostic-mac-vincent-primary.sh --health-check` |
| **status** | **Planned** — do not deploy this wrapper until the Source is enrolled. See enrollment prerequisites in [`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md). |

---

### `aks:TODO` and `container-host:TODO`

These Sources are planned. Wrapper scripts do not exist yet.

Do not create wrapper templates for these Sources until:
- `aks:TODO`: the AKS cluster name is confirmed and replaces `TODO` in the inventory map
- `container-host:TODO`: the container host target is confirmed

When a target is confirmed:
1. Update `target_identifier` in `docs/operators/source-inventory-map.md`.
2. Create the Source in SignalForge.
3. Enroll the automation-agent token per `selene-multi-source-enrollment.md`.
4. Copy a wrapper template and update `SOURCE_IDENTIFIER`, `ARTIFACT_FAMILY`, and `TOKEN_FILE`.
5. Add the wrapper to this document.

---

## Wrapper interface contract

All source-bound wrappers follow the same interface:

```
Usage: signalforge-diagnostic-<source-slug>.sh [options]

Options:
  --reason TEXT       Diagnostic request reason string
  --wait              Poll until terminal state (submitted, failed, cancelled, expired)
  --timeout SECONDS   Wait timeout in seconds (default: 300)
  --health-check      Validate token file and SignalForge reachability; no request
  -h, --help          Show this help
```

**Exit codes:**

| code | meaning |
|------|---------|
| 0 | Success (request submitted or health check passed) |
| 1 | Usage error (bad argument) |
| 2 | Configuration error (token file missing, agent script not found) |
| 3 | Health check failed (SignalForge unreachable in `--health-check` mode) |
| other | Propagated from `signalforge-automation-agent.sh` or curl |

**Required environment:**

| variable | required | description |
|----------|----------|-------------|
| `SIGNALFORGE_BASE_URL` | yes | SignalForge base URL |
| `SIGNALFORGE_SELENE_TOKEN_FILE` | no | Override token file path |
| `SIGNALFORGE_AGENT_SCRIPT` | no | Override path to `signalforge-automation-agent.sh` |

**Wrapper does not accept `source_id` overrides.** The source is bound at the
constant level in the script header. If you need to target a different Source,
use that Source's wrapper.

---

## Deploying a wrapper to velora-infra

This repo provides templates in `examples/selene-wrappers/`. To deploy:

1. Copy the template to the production path in velora-infra:
   ```
   /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-<source-slug>.sh
   ```
2. Set `SIGNALFORGE_AGENT_SCRIPT` to the location of `signalforge-automation-agent.sh`
   on the production host, or ensure it is on PATH.
3. Confirm the token file is at the expected path with `root:<selene-runtime-group> 0640`.
4. Run `--health-check` to confirm the wrapper is wired up correctly:
   ```bash
   SIGNALFORGE_BASE_URL=https://<host> \
     /opt/velora-infra/.../signalforge-diagnostic-<source-slug>.sh --health-check
   ```
5. Run a smoke diagnostic request:
   ```bash
   SIGNALFORGE_BASE_URL=https://<host> \
     /opt/velora-infra/.../signalforge-diagnostic-<source-slug>.sh --reason "slice-4 smoke" --wait
   ```

Do not commit production token values or host-specific configuration back to
this repo. The templates contain no secrets.

---

## Related docs

- [`source-inventory-map.md`](./source-inventory-map.md)
- [`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md)
- [`automation-agent-integration.md`](./automation-agent-integration.md)
- [`selene-codex-app-server-integration.md`](./selene-codex-app-server-integration.md)
- [`../../examples/selene-wrappers/`](../../examples/selene-wrappers/)
