# Phase 12: Fleet Diagnostic Surfaces

Status: planned

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

Done when each planned Source has:

- target identifier
- artifact family
- collection scope
- expected execution form
- credential store
- Selene access decision
- safe-fix policy decision

### Slice 3: Multi-Source Selene Enrollment

Give Selene a durable way to discover which Sources she can operate without
copying tokens through chat or collapsing all authority into one credential.

Done when:

- each Source has a source-bound automation-agent registration
- tokens are stored in Infisical or source-local runtime files
- Selene can list/access configured wrappers without seeing token values
- cross-source override attempts remain rejected

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
