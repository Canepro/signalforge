# Automation-Agent Source Wrappers

Status: Phase 12 slice 4 reference
Updated: 2026-05-27

This document defines the source-bound wrapper contract for automation-agent
diagnostic requests. A wrapper is a small script that reads one token file,
calls the SignalForge automation-agent API, and optionally waits for the result.

For token naming and enrollment see
[`automation-agent-multi-source-enrollment.md`](./automation-agent-multi-source-enrollment.md).
For the HTTP contract see
[`automation-agent-integration.md`](./automation-agent-integration.md).
For the Source map see [`source-inventory-map.md`](./source-inventory-map.md).

## Design Principles

- **One wrapper per Source.** Each script is bound to exactly one
  `target_identifier`.
- **Source-bound by construction.** Source identifier and token path are
  constants in the wrapper configuration.
- **No printed tokens.** Wrappers read token files without echoing values or
  enabling shell traces.
- **No-value health check.** `--health-check` validates token-file presence and
  SignalForge reachability without requesting diagnostics.
- **Explicit fix policy.** Wrappers request diagnostics only. Fix actions use
  separate policy-gated APIs.
- **Templates only in this repo.** `examples/automation-agent-wrappers/` contains public
  templates. Production wrappers and private host paths belong in the
  operations repo.

## Naming Convention

```text
signalforge-diagnostic-<source-slug>.sh
```

`source-slug` is the `target_identifier` with `:` replaced by `-`, kept
lowercase.

| target identifier | wrapper name |
| --- | --- |
| `kubernetes:<cluster-name>` | `signalforge-diagnostic-kubernetes-<cluster-name>.sh` |
| `linux:<host-label>` | `signalforge-diagnostic-linux-<host-label>.sh` |
| `mac:<workstation>` | `signalforge-diagnostic-mac-<workstation>.sh` |
| `aks:<cluster-name>` | `signalforge-diagnostic-aks-<cluster-name>.sh` |
| `container-host:<host-label>` | `signalforge-diagnostic-container-host-<host-label>.sh` |

## Per-Source Reference Template

| field | value |
| --- | --- |
| **target_identifier** | `linux:<host-label>` or another stable Source key |
| **artifact family** | `linux-audit-log`, `kubernetes-bundle`, or `container-diagnostics` |
| **template script** | `examples/automation-agent-wrappers/signalforge-diagnostic-<source-slug>.sh` |
| **production script location** | Private operations repo or host scripts path |
| **token file** | `<token-dir>/signalforge-automation-agent-token-<source-slug>` |
| **token env var** | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN` |
| **Infisical secret** | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>` |
| **safe-fix policy** | `none` or one named deterministic policy |
| **collection window** | Host- or cluster-specific preflight needed before requesting |
| **expected terminal states** | `submitted`, `failed`, `cancelled`, `expired` |
| **validation command** | `SIGNALFORGE_BASE_URL=<url> <wrapper> --health-check` |

Keep private source names, cluster names, kubeconfig paths, and run ids in the
private operations inventory. This public document should stay pattern-based.

## Wrapper Interface Contract

```text
Usage: signalforge-diagnostic-<source-slug>.sh [command] [options]

Commands:
  signals                 Fetch source-bound signals
  collect REASON          Request diagnostics for a real operator reason
  collect-summary REASON  Request diagnostics and print normalized JSON
  summarize REQUEST_ID    Print normalized JSON for an existing request
  process                 Run any source-specific helper window, if needed

Options:
  --reason TEXT       Diagnostic request reason string
  --wait              Poll until terminal state
  --timeout SECONDS   Wait timeout in seconds
  --health-check      Validate token file and SignalForge reachability; no request
  -h, --help          Show help
```

**Exit codes**

| code | meaning |
| --- | --- |
| 0 | Success |
| 1 | Usage error |
| 2 | Configuration error, such as missing token file |
| 3 | Health check failed |
| other | Propagated from the API helper or curl |

**Environment**

| variable | required | description |
| --- | --- | --- |
| `SIGNALFORGE_BASE_URL` | yes | SignalForge base URL |
| `SIGNALFORGE_TOKEN_FILE` | no | Override token file path |
| `SIGNALFORGE_AGENT_SCRIPT` | no | Override path to `signalforge-automation-agent.sh` |

The wrapper must not accept a `source_id` override. Use the wrapper for the
Source you intend to operate.

## Deployment Steps

1. Copy the appropriate template into the private operations repo or host script
   directory.
2. Configure `SIGNALFORGE_AGENT_SCRIPT` or ensure the helper is on `PATH`.
3. Confirm the per-source token file exists with restrictive permissions.
4. Run `--health-check`.
5. Request diagnostics for a real operator reason.
6. Store the private request id, run id, status, and top findings in the private
   verification report.

For a deployment checklist and report template, see
[`automation-agent-wrapper-deployment-checklist.md`](./automation-agent-wrapper-deployment-checklist.md).

Do not commit production token values or host-specific configuration back to
this repo.

## Related Docs

- [`automation-agent-wrapper-deployment-checklist.md`](./automation-agent-wrapper-deployment-checklist.md)
- [`source-inventory-map.md`](./source-inventory-map.md)
- [`automation-agent-multi-source-enrollment.md`](./automation-agent-multi-source-enrollment.md)
- [`automation-agent-integration.md`](./automation-agent-integration.md)
- [`automation-agent-codex-app-server-integration.md`](./automation-agent-codex-app-server-integration.md)
