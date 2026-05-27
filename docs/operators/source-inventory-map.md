# Source Inventory Map

Status: slice 2 of Phase 12  
Updated: 2026-05-27  
Maintained by: Vincent Mogah

This document maps every planned and enrolled diagnostic Source to its stable
target identifier, artifact family, collection scope, execution form, credential
store, Selene access decision, and safe-fix policy. It is the authoritative
reference before enrolling new tokens or adding automation agents.

**Do not add secrets, token values, kubeconfig content, or IP addresses to this
file. Paths to secret store files are safe to document; values are not.**

---

## Quick reference

| target\_identifier      | status    | artifact family       | Selene access | safe-fix |
|-------------------------|-----------|-----------------------|---------------|----------|
| `oke:prod-eu1`          | live      | `kubernetes-bundle`   | yes           | `kubernetes.disable-service-account-token-automount.v1` only |
| `linux:hostinger-prod`  | enrolled  | `linux-audit-log`     | yes           | none |
| `mac:vincent-primary`   | planned   | `linux-audit-log`*    | planned       | none |
| `aks:TODO`              | planned   | `kubernetes-bundle`   | planned       | none |
| `container-host:TODO`   | planned   | `container-diagnostics` | planned     | none |

\* Pending `mac-diagnostics` family decision. See open question in
[`phase-12-fleet-diagnostic-surfaces.md`](../../plans/phase-12-fleet-diagnostic-surfaces.md).

**Status key**

| value    | meaning |
|----------|---------|
| `live`   | Selene automation-agent path tested end-to-end |
| `enrolled` | Source and execution-agent token exist in the app; automation-agent token issued; not yet smoke-tested end-to-end |
| `planned` | Fields documented; Source not yet created in the app |

---

## Sources

### `oke:prod-eu1`

| field | value |
|-------|-------|
| **target\_identifier** | `oke:prod-eu1` |
| **display name** | OKE cluster / oke-prod-eu1 |
| **artifact family** | `kubernetes-bundle` |
| **status** | live |

**Collection scope**

```json
{
  "kind": "kubernetes_scope",
  "scope_level": "cluster",
  "kubectl_context": "oke-primary",
  "cluster_name": "oke-prod-eu1",
  "provider": "oke"
}
```

Note: the kubeconfig context on the VPS execution host is `oke-primary`. Do
not use `oke-cluster` — that context name does not resolve on the host.

| field | value |
|-------|-------|
| **execution form** | Cluster-side `signalforge-agent` Deployment (or wrapper-triggered collection from VPS) |
| **credential store — execution agent** | `signalforge-agent` service env or Infisical-injected; stored as token hash in app |
| **credential store — automation agent** | Legacy: `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token` (in use); target: `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-oke-prod-eu1` after slice 4 wrapper update |
| **Infisical secret name** | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_OKE_PROD_EU1` |
| **Selene wrapper (current live)** | `/opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic.sh` |
| **Selene wrapper (target)** | `/opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-oke-prod-eu1.sh` |
| **wrapper template** | `examples/selene-wrappers/signalforge-diagnostic-oke-prod-eu1.sh` |
| **Selene access** | yes — automation-agent token enrolled; Selene can request runs and poll results for this Source |
| **safe-fix policy** | `kubernetes.disable-service-account-token-automount.v1` only; source automation and auto-fix must be explicitly enabled in the app before any fix action is created |
| **validation proof** | Selene live path confirmed working via velora-infra; OKE-scope kubernetes-bundle runs appear in the app with Kubernetes findings |

---

### `linux:hostinger-prod`

| field | value |
|-------|-------|
| **target\_identifier** | `linux:hostinger-prod` |
| **display name** | Hostinger VPS — prod lane |
| **artifact family** | `linux-audit-log` |
| **status** | enrolled |

**Collection scope**

```json
{
  "kind": "linux_host"
}
```

| field | value |
|-------|-------|
| **execution form** | `systemd` long-lived execution agent (`signalforge-agent`) on the VPS host |
| **credential store — execution agent** | Stored at a host-local path under `/etc/velora-infra/` (exact file separate from the Selene automation token; do not mix the two) |
| **credential store — automation agent** | `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod` (per-source naming; separate from OKE token) |
| **Infisical secret name** | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_LINUX_HOSTINGER_PROD` |
| **Selene wrapper (target)** | `/opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-linux-hostinger-prod.sh` |
| **wrapper template** | `examples/selene-wrappers/signalforge-diagnostic-linux-hostinger-prod.sh` |
| **Selene access** | yes — automation-agent token issued; end-to-end smoke not yet confirmed for Linux path |
| **safe-fix policy** | none — no safe-fix policy enabled for Linux host sources |
| **wrapper preflight** | Confirm `signalforge-agent` is running and heartbeating before requesting collection |
| **validation proof needed** | Run one `linux-audit-log` collection job through the enrolled agent and confirm the run appears in the app with audit findings |

---

### `mac:vincent-primary`

| field | value |
|-------|-------|
| **target\_identifier** | `mac:vincent-primary` |
| **display name** | Vincent — primary Mac workstation |
| **artifact family** | `linux-audit-log` (interim; see open question below) |
| **status** | planned |

**Collection scope** (interim, pending mac-diagnostics family)

```json
{
  "kind": "linux_host"
}
```

| field | value |
|-------|-------|
| **execution form** | Local `signalforge-agent` service or manual push from the workstation |
| **credential store — execution agent** | `~/.config/signalforge/agent-token` or Infisical dev injection |
| **credential store — automation agent** | `~/.config/signalforge/selene-automation-agent-token-mac-vincent-primary` (when enrolled) |
| **Infisical secret name** | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_MAC_VINCENT_PRIMARY` (add when source is enrolled) |
| **Selene access** | planned — automation-agent token not yet issued; Selene access makes sense when on the same network or VPN |
| **safe-fix policy** | none |
| **wrapper template** | `examples/selene-wrappers/signalforge-diagnostic-mac-vincent-primary.sh` (do not deploy until enrolled) |
| **wrapper/preflight** | Local `bun run dev` or `signalforge-agent` service |
| **validation proof needed** | Run one collection job from a local agent on the workstation and confirm the run appears in the app |

**Open question:** Should Mac workstation diagnostics reuse `linux-audit-log`
for Darwin-friendly sections, or become a dedicated `mac-diagnostics` artifact
family? Do not enroll until this is decided.

---

### `aks:TODO`

| field | value |
|-------|-------|
| **target\_identifier** | `aks:TODO` — exact cluster name unknown; update before enrolling |
| **display name** | TODO — AKS cluster name |
| **artifact family** | `kubernetes-bundle` |
| **status** | planned |

**Collection scope** (fill in before enrolling)

```json
{
  "kind": "kubernetes_scope",
  "scope_level": "cluster",
  "kubectl_context": "TODO",
  "cluster_name": "TODO",
  "provider": "aks"
}
```

| field | value |
|-------|-------|
| **execution form** | Cluster-side `signalforge-agent` Deployment with read-only RBAC |
| **credential store** | TODO — Infisical AKS path or cluster-side ServiceAccount |
| **Selene access** | planned — decide whether to start with production cluster (read-only diagnostics only) or a lower-risk validation cluster |
| **safe-fix policy** | none initially; `kubernetes.disable-service-account-token-automount.v1` may be added once diagnostics are reliable |
| **wrapper/preflight** | TODO — document kubeconfig or workload-identity bootstrap |
| **validation proof needed** | Confirm `kubectl --context=<target> auth can-i list pods --all-namespaces` passes for the agent ServiceAccount before enrolling |

**Prerequisite:** resolve which AKS cluster to target before creating the
Source in the app. See open question in
[`phase-12-fleet-diagnostic-surfaces.md`](../../plans/phase-12-fleet-diagnostic-surfaces.md).

---

### `container-host:TODO`

| field | value |
|-------|-------|
| **target\_identifier** | `container-host:TODO` — update to a stable host label when ready |
| **display name** | TODO — container runtime host |
| **artifact family** | `container-diagnostics` |
| **status** | planned |

**Collection scope** (fill in before enrolling)

```json
{
  "kind": "container_target",
  "container_ref": "TODO",
  "runtime": "docker"
}
```

Replace `"docker"` with `"podman"` if the host uses Podman. Set `container_ref`
to the stable workload identifier (not an ephemeral container ID).

| field | value |
|-------|-------|
| **execution form** | Host agent (`signalforge-agent`) with runtime socket access |
| **credential store** | TODO — source-local runtime file or Infisical host path |
| **Selene access** | planned |
| **safe-fix policy** | none |
| **wrapper/preflight** | TODO — confirm runtime socket access and container target before enrolling |
| **validation proof needed** | Run one `container-diagnostics` collection job and confirm container posture findings appear in the app |

---

## Enrollment checklist

Use this checklist before creating any Source entry in the app.

- [ ] target\_identifier is stable and operator-chosen (not a transient hostname or ephemeral ID)
- [ ] artifact family is one of `linux-audit-log`, `kubernetes-bundle`, `container-diagnostics` (or a documented future family)
- [ ] collection scope JSON is valid against `CollectionScope` in `src/lib/collection-scope.ts`
- [ ] execution agent token will be stored at a source-local path (not printed to logs or chat)
- [ ] automation agent token (for Selene) stored at a path that Selene can read on the relevant host
- [ ] Selene access decision is explicit (yes / no / planned)
- [ ] safe-fix policy decision is explicit (none / named policy only)
- [ ] at least one successful collection run has been observed before Selene automation is turned on

## Credential separation reminder

Each Source has at most two tokens:

1. **Collection execution-agent token** — used by `signalforge-agent` for
   heartbeat, job polling, artifact upload. Never used by Selene.
2. **Automation-agent token** — used by Selene (or a future operator agent) to
   request diagnostics and read results. Never used for job execution.

Do not share these tokens across Sources. Do not store token values in this
file, in plans, or in chat history.
