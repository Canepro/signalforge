# Phase 12: Fleet Diagnostic Surfaces

Status: slice 1 complete; slice 2 complete; slice 3 in progress

## Goal

Make SignalForge useful as the diagnostics control plane for Vincent's real
machines and operational surfaces without turning the app into an RMM, SSH
broker, or arbitrary command runner.

Selene should be able to request and read diagnostics for source-bound targets
such as:

- Mac workstation
- Linux hosts and VPS lanes
- AKS clusters
- OKE clusters
- container/runtime surfaces
- future narrow diagnostic surfaces that produce evidence artifacts

## Product Boundary

SignalForge owns:

- Sources as durable target identities
- source-bound execution-agent registration
- source-bound automation-agent access for Selene or similar operators
- diagnostic request state
- artifact ingestion
- deterministic analysis
- guarded action requests where a deterministic policy explicitly allows them

SignalForge does not own:

- raw fleet credentials
- arbitrary SSH, shell, kubectl, or YAML execution
- broad scheduling policy inside the app
- a generic remediation engine
- collector implementation details

Collection and action execution stay outside SignalForge in source-local agents
or wrappers that already live in the operator's trust boundary.

## Source Model

Treat each diagnostic surface as a Source with explicit artifact and execution
scope:

| Surface | Source target example | Artifact family | Execution form |
|---------|-----------------------|-----------------|----------------|
| Mac workstation | `mac:vincent-primary` | `linux-audit-log` or future `mac-diagnostics` | local host agent or manual push |
| Linux VPS | `linux:hostinger-prod` | `linux-audit-log` | host `systemd` execution agent |
| AKS cluster | `aks:prod-eu1` | `kubernetes-bundle` | cluster-side Deployment |
| OKE cluster | `oke:prod-eu1` | `kubernetes-bundle` | cluster-side Deployment |
| Container host | `container-host:prod` | `container-diagnostics` | host runner with runtime socket access |

The target identifier must be stable and operator-chosen. Hostnames, cluster
names, and provider labels can appear as metadata, but compare and automation
should anchor on the Source target key.

## Selene Contract

Selene receives one automation-agent token per Source or per bounded operator
scope. That token can:

- read source-bound signals
- request diagnostics for the bound Source
- poll diagnostic results
- request safe-fix actions only when the Source and deterministic policy allow it

That token cannot:

- override `source_id`
- read or write other Sources
- act as an execution-agent token
- read raw database state
- become Codex App Server identity

## Implementation Slices

### Slice 1: Large-Run Brain Hardening

Use compact LLM enrichment for large deterministic runs so big Kubernetes
bundles still get operator summaries without requiring the model to return every
finding and every evidence string.

Done when:

- large Kubernetes runs use a compact enrichment response schema
- final reports still contain the full deterministic finding list
- malformed or oversized enrichment output falls back without losing findings
- regression coverage exists for large Kubernetes bundles

### Slice 2: Source Inventory Map

Add a documented operator map for Vincent's real diagnostic surfaces:

- Mac
- VPS/Linux hosts
- OKE
- AKS
- container/runtime surfaces

Canonical document: [`docs/operators/source-inventory-map.md`](../docs/operators/source-inventory-map.md)

Done when each planned Source has:

- target identifier
- artifact family
- collection scope
- expected execution form
- credential store
- Selene access decision
- safe-fix policy decision

**Current state (2026-05-27):**

- `oke:prod-eu1` — live; Selene path confirmed end-to-end
- `linux:hostinger-prod` — enrolled; end-to-end smoke pending
- `mac:vincent-primary` — planned; blocked on mac-diagnostics family decision
- `aks:TODO` — planned; cluster name unknown; do not enroll until resolved
- `container-host:TODO` — planned; target surface not yet chosen

### Slice 3: Multi-Source Selene Enrollment

Give Selene a durable way to discover which Sources she can operate without
copying tokens through chat or collapsing all authority into one credential.

Operator runbook: [`docs/operators/selene-multi-source-enrollment.md`](../docs/operators/selene-multi-source-enrollment.md)

**Infisical naming convention (one secret per Source):**

| target\_identifier     | Infisical secret name |
|------------------------|-----------------------|
| `oke:prod-eu1`         | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_OKE_PROD_EU1` |
| `linux:hostinger-prod` | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_LINUX_HOSTINGER_PROD` |
| `mac:vincent-primary`  | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_MAC_VINCENT_PRIMARY` |
| `aks:TODO`             | *(wait for cluster name)* |
| `container-host:TODO`  | *(wait for target name)* |

Pattern: `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>` where
`SOURCE_SLUG` = `target_identifier` with `:` and `-` → `_`, uppercased.

**Host file naming convention:**

```
/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-<source-slug>
```

The OKE token at the legacy unsuffixed path stays in place until the slice 4
wrapper update. All new enrollments use the per-source suffix.

**Discovery model:** Source-bound at invocation time, not dynamic. The wrapper
script for each Source reads its own token file. Selene never holds a
cross-source credential. Details in the runbook.

**Strict separation (preserved from prior slices):**

- automation-agent token ≠ execution-agent token
- Selene token ≠ Codex App Server identity
- SignalForge does not store raw kubeconfigs, SSH keys, or VPS credentials

Done when:

- each enrolled Source has a source-bound automation-agent registration
- per-source token stored in Infisical under the correct naming convention
- per-source token written to the host file path at the correct location
- Selene can list/access configured wrappers without seeing token values
- cross-source override attempts remain rejected
- `oke:prod-eu1` enrollment verified end-to-end (already live)
- `linux:hostinger-prod` enrollment smoke-tested end-to-end
- `mac:vincent-primary`, `aks:TODO`, `container-host:TODO` remain TODO pending prior blockers

**Current state (2026-05-27):**

- `oke:prod-eu1` — token enrolled and live; Infisical migration to per-source name pending
- `linux:hostinger-prod` — token enrollment steps documented; smoke test pending
- remaining sources — blocked on source-creation prerequisites from slice 2

### Slice 4: Surface-Specific Collect Wrappers

Create or document thin wrappers for each execution form:

- Mac/local host diagnostic
- Linux `systemd` host diagnostic
- AKS cluster diagnostic window
- OKE cluster diagnostic window
- container runtime diagnostic

Done when wrappers:

- queue or run only the Source they are bound to
- restore bounded helper state after temporary collection windows
- do not print secrets
- produce no-value health checks
- leave safe-fix disabled unless explicitly opted in

### Slice 5: Action Policy Expansion

Only after diagnostics are reliable, add more deterministic safe-action policies
where the action is narrow, reversible, and source-local.

Candidate policies:

- Kubernetes service-account token automount hardening
- Kubernetes probe/resource-limit suggestions as request-only actions
- host/container findings that can generate reviewed commands, not auto-run them

Done when every action has:

- deterministic eligibility
- source opt-in
- execution-agent capability match
- dry-run evidence
- post-action verification
- clear refusal when unsafe

## Open Questions

- Should Mac workstation diagnostics reuse `linux-audit-log` for Darwin-friendly
  sections, or become a separate `mac-diagnostics` artifact family?
- Should Selene hold one automation token per Source, or should SignalForge add
  a first-class operator identity that can be scoped to many Sources?
- Which AKS cluster should be first: a production cluster with read-only
  diagnostics, or a lower-risk validation cluster?
- Which actions should stay request-only forever, even if they are technically
  automatable?

## Non-Goals

- central SSH key storage in SignalForge
- in-app kubeconfig storage
- app-managed cron scheduler
- arbitrary command execution
- broad fleet inventory/RMM
- LLM-authored fixes
