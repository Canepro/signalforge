# Plan: Phase 8 Collection-Plane Follow-On

> Why this exists: Phase 8 in `signalforge` now supports `container-diagnostics` and `kubernetes-bundle` for ingestion, analysis, compare, and docs, and the external collection plane has now started to catch up. This file tracks what is actually real across the three repos and what still remains uneven.

## Problem statement

SignalForge now has meaningful multi-artifact analyzer support, but the end-to-end operator story is still uneven:

- `signalforge` can ingest and analyze Linux, container, and Kubernetes evidence
- `signalforge-collectors` now ships first container and Kubernetes producers in addition to Linux host audit
- `signalforge-agent` now dispatches by artifact family, but non-Linux job-driven collection still depends on host-local scope and environment
- frontend and docs must be honest about what is push-first, what is job-driven, and what is only planned

If we do not make the collection-plane state explicit, the product will look more complete than it really is, and future work will drift between three repos without a shared source of truth.

## Current reality to preserve

- `linux-audit-log`
  - push-first path exists via `signalforge-collectors`
  - job-driven path exists via `signalforge-agent`
- `container-diagnostics`
  - SignalForge analysis path exists
  - push-first path exists via `signalforge-collectors`
  - job-driven path exists from `signalforge-agent` when the host is explicitly prepared for one container target
- `kubernetes-bundle`
  - SignalForge analysis path exists
  - push-first path exists via `signalforge-collectors`
  - job-driven path exists from `signalforge-agent` when the host already has the intended `kubectl` context and scope

## Goal

Produce an evidence-based cross-repo plan that makes three things explicit:

1. what is already shipped in each repo
2. what is missing for container and Kubernetes collection parity
3. what should be built next, in which repo, and in what order

## Non-goals

- do not quietly imply that container or Kubernetes job-driven collection already exists
- do not commit to a Kubernetes execution form before scope and trust boundaries are explicit
- do not turn SignalForge into a privileged remote execution app

## Audit snapshot

### `signalforge`

Shipped now:

- source registration accepts supported artifact families
- collection jobs are queued against `source.expected_artifact_type`
- `jobs/next` already gates on `collect:<job.artifact_type>` capability matching
- container and Kubernetes analysis paths are shipped in this branch

Important implication:

- the control plane is already family-aware enough that the main missing parity is in the external repos, not in the core SignalForge data model

### `signalforge-agent`

Shipped now:

- one host-oriented Bun agent with `once` and `run`
- one Linux / WSL `systemd` deployment form
- family-aware collector dispatch
- artifact-type-aware upload
- default capability advertisement derived from local readiness, with explicit override support

Not shipped now:

- no container image build
- no Kubernetes manifests
- no per-job family-specific runtime parameters
- no container image or Kubernetes-native packaging for the agent

Important implication:

- the host agent can now process `container-diagnostics` and `kubernetes-bundle` jobs, but only when its local runtime has already been prepared for that family and scope

### `signalforge-collectors`

Shipped now:

- Linux host audit collector
- Linux diff helper
- container diagnostics collector
- Kubernetes bundle collector
- one push wrapper that can upload Linux, container, or Kubernetes artifacts with explicit metadata

Not shipped now:

- no container-native packaging
- no Kubernetes-native packaging
- no per-job parameter bridge back from SignalForge into collector invocation

Important implication:

- push-first parity now exists for all three shipped artifact families, but job-driven non-Linux collection still depends on process-local environment instead of job-scoped input

### Honest product line today

- `linux-audit-log`: end-to-end collection and analysis exists
- `container-diagnostics`: analysis exists; push-first collection exists; job-driven collection works from a prepared host agent but is not yet a clean multi-target deployment model
- `kubernetes-bundle`: analysis exists; push-first collection exists; job-driven collection works from a prepared host agent but is not yet a clean multi-scope deployment model

## Workstreams

### 1. `signalforge` audit

Confirm what the main product repo already supports for:

- artifact families
- compare and target identity
- frontend and docs honesty
- source and registration model constraints

### 2. `signalforge-agent` audit

Confirm:

- current capability model
- current collector dispatch model
- current deployment forms actually implemented
- whether container or Kubernetes collection can be added as new capabilities without breaking the current host agent model

### 3. `signalforge-collectors` audit

Confirm:

- current collectors actually shipped
- what is reusable for push-first container and Kubernetes collection
- what new artifact producers or wrappers would be required

### 4. Cross-repo synthesis

Produce one joined inventory:

- shipped now
- push-first deliverable next
- job-driven follow-on later
- architecture gates that must be decided before multi-scope agent work

## Recommended sequencing

### Step 1. Audit before coding

Use parallel review across `signalforge-agent` and `signalforge-collectors` while keeping the main synthesis local in this repo.

### Step 2. Lock the honest product story

Make the docs and frontend say clearly:

- Linux host collection is fully supported end to end
- container and Kubernetes analysis are shipped
- push-first collection exists for container and Kubernetes
- host-agent job-driven collection for container and Kubernetes is possible, but still depends on host-local scope prep rather than job-scoped parameters

### Step 3. Define push-first parity work

Prefer the narrowest credible collection-plane additions first:

- family-aware push examples and docs
- collector install guidance by environment
- operator-facing UI language that explains when push-first versus job-driven is the honest path

### Step 4. Decide whether job-driven parity is worth it

Only after real push-first usage:

- add job-scoped family parameters or scope selectors
- choose deployment forms for container and Kubernetes

## Likely implementation slices after the audit

1. Docs and frontend honesty pass across all three repos
2. `signalforge-collectors`: container and Kubernetes collector docs and operator examples
3. `signalforge-agent`: family-aware capability and dispatch
4. `signalforge-agent`: explicit `artifact_type` upload alignment with queued-job contract
5. `signalforge-agent`: job-scoped runtime parameter model
6. `signalforge-agent`: first non-Linux execution form, only after scope and trust are explicit

## Decision gates

Before any non-Linux agent implementation, lock:

- whether container collection is host-runtime scoped, workload scoped, or helper-script scoped
- whether Kubernetes collection is namespace scoped, cluster scoped, or both
- whether one source can map to multiple execution scopes or registrations
- which deployment forms are first-class:
  - host service
  - container image
  - Kubernetes `Job`
  - Kubernetes `Deployment`
  - Kubernetes `DaemonSet`

## Recommended immediate next moves

1. Keep the frontend and docs honest first.
   The product should clearly say that Linux is the cleanest end-to-end path, while container and Kubernetes now have both push-first and host-agent paths with real scope limitations.
2. Add a job-scoped parameter model before pretending non-Linux job-driven collection is fully solved.
   Container target selection and Kubernetes scope should not stay hidden in process-local environment forever.
3. Delay new packaging until the scope model is explicit.
   Container images, Kubernetes `Job`s, or `DaemonSet`s will be much easier to justify once the runtime contract is clear.

## Deliverable for this thread

This thread should end with:

- a concrete inventory of the three repos
- a gap list for container and Kubernetes support
- a recommended cross-repo sequence
- explicit notes on what is real today versus only planned
