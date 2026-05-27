# Phase 12: Fleet Diagnostic Surfaces

Status: slice 1 complete; slice 2 complete; slice 3 in progress; slice 4 complete; operational follow-through in progress

## Goal

Make SignalForge useful as the diagnostics control plane for real operator
machines and operational surfaces without turning the app into an RMM, SSH
broker, or arbitrary command runner.

An external operator automation agent should be able to request and read diagnostics for source-bound targets
such as:

- Mac workstation
- Linux hosts
- AKS clusters
- Kubernetes clusters
- container/runtime surfaces
- future narrow diagnostic surfaces that produce evidence artifacts

## Product Boundary

SignalForge owns:

- Sources as durable target identities
- source-bound execution-agent registration
- source-bound automation-agent access for external operator agents
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
| Mac workstation | `mac:<workstation>` | `linux-audit-log` or future `mac-diagnostics` | local host agent or manual push |
| Linux host | `linux:<host-label>` | `linux-audit-log` | host `systemd` execution agent |
| AKS cluster | `aks:prod-eu1` | `kubernetes-bundle` | cluster-side Deployment |
| Kubernetes cluster | `kubernetes:<cluster-name>` | `kubernetes-bundle` | cluster-side Deployment |
| Container host | `container-host:prod` | `container-diagnostics` | host runner with runtime socket access |

The target identifier must be stable and operator-chosen. Hostnames, cluster
names, and provider labels can appear as metadata, but compare and automation
should anchor on the Source target key.

## Automation-Agent Contract

An external operator agent receives one automation-agent token per Source or per bounded operator
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

Add a documented operator map for the diagnostic surfaces in scope:

- Mac
- Linux hosts
- Kubernetes clusters
- AKS
- container/runtime surfaces

Canonical document: [`docs/operators/source-inventory-map.md`](../docs/operators/source-inventory-map.md)

Done when each planned Source has:

- target identifier
- artifact family
- collection scope
- expected execution form
- credential store
- automation-agent access decision
- safe-fix policy decision

**Current state (2026-05-27):**

- `kubernetes:<cluster-name>` — example-live pattern; private deployments record concrete source names outside this repo
- `linux:<host-label>` — example-live pattern; private deployments record concrete source names outside this repo
- `mac:<workstation>` — planned; blocked on mac-diagnostics family decision; Mac (Darwin) workstation, not Linux/WSL
- `aks:<cluster-name>` — planned; cluster name unknown; do not enroll until resolved; see source-inventory-map for naming conventions
- `container-host:<host-label>` — planned; target surface not yet chosen; see source-inventory-map for naming conventions

### Slice 3: Multi-Source Automation-Agent Enrollment

Give an external operator agent a durable way to discover which Sources it can operate without
copying tokens through chat or collapsing all authority into one credential.

Operator runbook: [`docs/operators/automation-agent-multi-source-enrollment.md`](../docs/operators/automation-agent-multi-source-enrollment.md)

**Infisical naming convention (one secret per Source):**

| target\_identifier     | Infisical secret name |
|------------------------|-----------------------|
| `kubernetes:<cluster-name>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_KUBERNETES_<CLUSTER_NAME>` |
| `linux:<host-label>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_LINUX_<HOST_LABEL>` |
| `mac:<workstation>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_MAC_<WORKSTATION>` |
| `aks:<cluster-name>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_AKS_<CLUSTER_NAME>` |
| `container-host:<host-label>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_CONTAINER_HOST_<HOST_LABEL>` |

Pattern: `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>` where
`SOURCE_SLUG` = `target_identifier` with `:` and `-` → `_`, uppercased.

**Host file naming convention:**

```
<host-token-dir>/signalforge-automation-agent-token-<source-slug>
```

For host files, `<source-slug>` is `target_identifier` with `:` replaced by
`-`, kept lowercase. This is separate from the Infisical `SOURCE_SLUG`, which
uses `_` and uppercase.

Private deployments that migrated from a legacy unsuffixed token path should
record that cutover in their private operations repo. All new enrollments use
the per-source suffix.

**Discovery model:** Source-bound at invocation time, not dynamic. The wrapper
script for each Source reads its own token file. The automation agent never holds a
cross-source credential. Details in the runbook.

**Strict separation (preserved from prior slices):**

- automation-agent token ≠ execution-agent token
- automation-agent token ≠ Codex App Server identity
- SignalForge does not store raw kubeconfigs, SSH keys, or host credentials

Done when:

- each enrolled Source has a source-bound automation-agent registration
- per-source token stored in Infisical under the correct naming convention
- per-source token written to the host file path at the correct location
- the automation agent can list/access configured wrappers without seeing token values
- cross-source override attempts remain rejected
- one Kubernetes source enrollment verified end-to-end in a private deployment
- one Linux host enrollment verified end-to-end in a private deployment
- `mac:<workstation>`, `aks:<cluster-name>`, `container-host:<host-label>` remain planned pending source-creation prerequisites

**Current state (2026-05-27):**

- Kubernetes and Linux host patterns — verified in a private deployment; concrete source names and run ids stay outside this public repo
- remaining sources — blocked on source-creation prerequisites from slice 2

### Slice 4: Surface-Specific Collect Wrappers

Create or document thin wrappers for each execution form so source-bound
access is usable without token-path guessing or manual env-var setup.

Wrapper contract doc: [`docs/operators/automation-agent-source-wrappers.md`](../docs/operators/automation-agent-source-wrappers.md)
Template scripts: [`examples/automation-agent-wrappers/`](../examples/automation-agent-wrappers/)

**Per-source wrappers (one per Source, source-bound by construction):**

| target\_identifier     | template script | status |
|------------------------|-----------------|--------|
| `kubernetes:<cluster-name>` | `examples/automation-agent-wrappers/signalforge-diagnostic-<source-slug>.sh` | pattern verified in a private deployment |
| `linux:<host-label>` | `examples/automation-agent-wrappers/signalforge-diagnostic-<source-slug>.sh` | pattern verified in a private deployment |
| `mac:<workstation>`  | `examples/automation-agent-wrappers/signalforge-diagnostic-mac-<workstation>.sh` | template ready; deploy blocked on Source enrollment |
| `aks:<cluster-name>`   | *(create when cluster name is confirmed; follow naming conventions in source-inventory-map)* | blocked |
| `container-host:<host>` | *(create when target is confirmed; follow naming conventions in source-inventory-map)* | blocked |

**Wrapper interface contract:**

- `--reason TEXT` — diagnostic request reason
- `--wait` / `--timeout SECONDS` — poll to terminal state
- `--health-check` — validate token file and SignalForge reachability; no request

**Exit codes:** 0 success, 1 usage error, 2 config error (token file missing),
3 health check failed.

**Token-path cutover:**

- Verified in a private operations lane. The deployed wrapper reads the
  per-source suffixed token path, and the legacy unsuffixed token file is no
  longer used.

Done when wrappers:

- queue or run only the Source they are bound to
- do not print token values at any verbosity level
- produce a no-value health check via `--health-check`
- leave safe-fix disabled by default (wrappers request diagnostics only)
- template scripts pass `bash -n`

**Current state (2026-05-27):**

- Kubernetes wrapper pattern: live in a private deployment; per-source token path active
- Linux host wrapper pattern: live in a private deployment; source-bound diagnostic verified
- Mac wrapper: template ready; deploy deferred until Source enrollment prerequisites met
- AKS, container-host: naming conventions documented in source-inventory-map; template creation blocked on target discovery

### Operational follow-through

Deployment checklists and operator verification report template for the
private operations lane.

Checklist doc: [`docs/operators/automation-agent-wrapper-deployment-checklist.md`](../docs/operators/automation-agent-wrapper-deployment-checklist.md)

Covers:

- Kubernetes source token-path cutover completion and rollback notes
- Linux host initial wrapper deployment with preflight verification
- Blocked-sources table (mac, aks, container-host) with explicit blocker reasons
- Operator verification report template (fillable; stored in private operations
  notes, not committed here)

Done when:

- Kubernetes per-source token path and wrapper deployed and verified end-to-end
  in a private operations lane ✓
- Linux host wrapper deployed and live diagnostic verified end-to-end in a
  private operations lane ✓

**Current blockers (2026-05-27):**

- Kubernetes and Linux host patterns: complete in a private operations lane
- Mac/AKS/container-host: blocked on source-creation prerequisites

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
- Should an automation agent hold one automation token per Source, or should SignalForge add
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
