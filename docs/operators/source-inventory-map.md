# Source Inventory Map

Status: Phase 12 slice 2 reference
Updated: 2026-05-27

This document is the public template for mapping diagnostic Sources. Keep real
fleet names, host paths, kubeconfig paths, IPs, and token values in a private
operations repo or secret store. The SignalForge repo should document the
contract and safe examples only.

For enrollment and wrapper details see:

- [`automation-agent-multi-source-enrollment.md`](./automation-agent-multi-source-enrollment.md)
- [`automation-agent-source-wrappers.md`](./automation-agent-source-wrappers.md)
- [`automation-agent-integration.md`](./automation-agent-integration.md)

## Quick Reference

| target identifier pattern | status | artifact family | automation-agent access | safe-fix |
| --- | --- | --- | --- | --- |
| `kubernetes:<cluster-name>` | example-live | `kubernetes-bundle` | yes | named policy only |
| `linux:<host-label>` | example-live | `linux-audit-log` | yes | none |
| `mac:<workstation>` | planned | `mac-diagnostics` | planned | none |
| `aks:<cluster-name>` | planned | `kubernetes-bundle` | planned | none |
| `container-host:<host-label>` | planned | `container-diagnostics` | planned | none |

**Status key**

| value | meaning |
| --- | --- |
| `example-live` | Pattern has been proven in a private deployment; this row is still an anonymized example |
| `enrolled` | Source exists and tokens are issued, but a completed diagnostic has not been recorded yet |
| `planned` | Fields are documented; Source is not created yet |

## Source Template

Use one entry like this per Source in your private operations inventory.

| field | value |
| --- | --- |
| **target_identifier** | `linux:<host-label>`, `kubernetes:<cluster-name>`, `aks:<cluster-name>`, or `container-host:<host-label>` |
| **display name** | Operator-facing label that does not reveal private hostnames in public docs |
| **artifact family** | `linux-audit-log`, `kubernetes-bundle`, `container-diagnostics`, or `mac-diagnostics` |
| **status** | `planned`, `enrolled`, or `live` |
| **execution form** | Host `signalforge-agent`, cluster-side `signalforge-agent` Deployment, or manual artifact push |
| **credential store - execution agent** | Source-local execution token, separate from automation-agent token |
| **credential store - automation agent** | Per-source token file on the host where the operator automation runs |
| **Infisical secret name** | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>` |
| **wrapper template** | `examples/automation-agent-wrappers/signalforge-diagnostic-<source-slug>.sh` or a private wrapper path |
| **automation-agent access** | `yes`, `no`, or `planned` |
| **safe-fix policy** | `none` or a named deterministic policy |
| **validation proof** | Private run id, request id, date, and outcome; do not commit private reports here |

## Collection Scope Examples

Linux host:

```json
{
  "kind": "linux_host"
}
```

Kubernetes cluster:

```json
{
  "kind": "kubernetes_scope",
  "scope_level": "cluster",
  "kubectl_context": "<context-name>",
  "cluster_name": "<cluster-name>",
  "provider": "<provider>"
}
```

Container runtime host:

```json
{
  "kind": "container_target",
  "container_ref": "<stable-workload-id>",
  "runtime": "<docker|podman>"
}
```

## Naming Conventions

`SOURCE_SLUG` is the `target_identifier` with `:` and `-` replaced by `_`, then
uppercased.

| target identifier | secret name | token file |
| --- | --- | --- |
| `kubernetes:<cluster-name>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_KUBERNETES_<CLUSTER_NAME>` | `<token-dir>/signalforge-automation-agent-token-kubernetes-<cluster-name>` |
| `linux:<host-label>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_LINUX_<HOST_LABEL>` | `<token-dir>/signalforge-automation-agent-token-linux-<host-label>` |
| `mac:<workstation>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_MAC_<WORKSTATION>` | `~/.config/signalforge/automation-agent-token-mac-<workstation>` |
| `aks:<cluster-name>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_AKS_<CLUSTER_NAME>` | `<token-dir>/signalforge-automation-agent-token-aks-<cluster-name>` |
| `container-host:<host-label>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_CONTAINER_HOST_<HOST_LABEL>` | `<token-dir>/signalforge-automation-agent-token-container-host-<host-label>` |

## Enrollment Checklist

- [ ] `target_identifier` is stable and operator-chosen.
- [ ] Artifact family is supported by the app.
- [ ] Collection scope JSON matches `CollectionScope` in `src/lib/collection-scope.ts`.
- [ ] Execution-agent token and automation-agent token are separate credentials.
- [ ] Automation-agent token is source-bound and stored outside Git.
- [ ] Safe-fix policy is explicit: `none` or one named policy.
- [ ] At least one completed diagnostic is recorded before the Source is treated as live.
- [ ] Private run ids, host paths, and source names live in the private operations inventory.

## Credential Separation

1. **Execution-agent token** - used by `signalforge-agent` for heartbeat, job
   polling, claiming jobs, and artifact upload.
2. **Automation-agent token** - used by an external operator agent to read
   source-bound signals, request diagnostics, poll results, and request
   permitted fix actions.
3. **Admin token** - used by operators to create Sources and enroll agents.

Never reuse one token type as another. SignalForge stores issued token hashes;
raw tokens, kubeconfigs, SSH keys, and host credentials stay outside this repo.
