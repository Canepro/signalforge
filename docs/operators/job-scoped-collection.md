# Job-Scoped Collection

This document explains the typed collection-scope contract that SignalForge stores and returns for job-driven collection.

## Why It Exists

For non-Linux job-driven collection, a queued job needs to say what should actually be collected.

That means SignalForge should store explicit scope instead of depending on hidden host-local state such as:

- a pre-exported container reference
- a mutable runtime choice
- whichever `kubectl` context happens to be active for a human user

## Current Shape

SignalForge currently supports these typed scope kinds:

- `linux_host`
- `container_target`
- `kubernetes_scope`

### `linux_host`

Use for host-level Linux or WSL audit collection.

This is intentionally simple and does not require extra per-job target data.

### `container_target`

Current fields:

- `container_ref`
- optional `runtime`
- optional `host_hint`

Use this when the operator wants a specific container or workload on a specific runtime host.

### `kubernetes_scope`

Current fields:

- `scope_level`
- optional `namespace`
- optional `kubectl_context`
- optional `cluster_name`
- optional `provider`

Use this when the operator wants cluster-scoped or namespace-scoped Kubernetes evidence.

## Where Operators Set It

SignalForge supports both:

- **Source defaults**: stored on the Source for repeated collection against the same logical target
- **Per-job overrides**: supplied when queuing an individual collection job

The queued job stores the resolved scope after applying any override.

## Where Operators See It

SignalForge now exposes the resolved scope in:

- Sources create and edit flows
- the request-collection flow
- Source detail pages
- queued job detail and timeline surfaces
- `GET /api/agent/jobs/next`

That means queued work is self-describing on the SignalForge side.

## What Is Shipped Here

In this repo, the typed scope model is already implemented end to end for the control plane:

- validation helpers and family matching
- Source default scope persistence
- CollectionJob scope persistence
- `jobs/next` returning resolved `collection_scope`
- published schemas and API contract
- operator UI visibility for defaults and resolved job scope

## Cross-Repo Status

The control-plane contract is no longer the missing piece.

Across the sibling repos:

- `signalforge-agent` maps the typed scope to collector invocation and logs the claimed scope clearly
- `signalforge-collectors` documents and validates the stable Linux, container, and Kubernetes input contract
- repo-local end-to-end validation now covers Linux, container, and Kubernetes job-driven flows against a live SignalForge dev server

So the honest statement today is:

- SignalForge knows and stores what the job intends to collect
- the agent and collectors honor that typed scope contract
- the remaining risk is execution-environment readiness, such as runtime socket access, kubeconfig or RBAC access, and production-like host validation

## Related Docs

- operator lifecycle: [`sources-and-agents.md`](./sources-and-agents.md)
- environment guidance: [`collection-paths.md`](./collection-paths.md)
- source-of-truth phase design: [`../../plans/phase-9-job-scoped-collection-parameters.md`](../../plans/phase-9-job-scoped-collection-parameters.md)
