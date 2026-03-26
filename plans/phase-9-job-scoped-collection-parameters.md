# Phase 9 Design: Job-Scoped Collection Parameters

> Status: design-first follow-on after Phase 8 analyzer and collection-plane parity work.

## Why this exists

Phase 8 made three things true at once:

- SignalForge now analyzes `linux-audit-log`, `container-diagnostics`, and `kubernetes-bundle`
- `signalforge-collectors` now ships first real producers for all three artifact families
- `signalforge-agent` can now dispatch by artifact family

That closes the obvious feature gap, but it exposes the next real contract problem:

- Linux jobs work cleanly with the current source model
- container and Kubernetes jobs still depend on process-local environment such as:
  - `SIGNALFORGE_CONTAINER_REF`
  - `SIGNALFORGE_CONTAINER_RUNTIME`
  - active `kubectl` context
  - `SIGNALFORGE_KUBERNETES_SCOPE`
  - `SIGNALFORGE_KUBERNETES_NAMESPACE`

That is good enough for first validation, but it is not a clean operator model.

The next design step is to move family-specific runtime parameters out of hidden host-local state and into an explicit SignalForge contract.

## Problem statement

The current model still assumes:

- one registration per source
- one expected artifact family per source
- capability gating by `collect:<artifact_type>`

That is still workable for Linux host collection, but it is not expressive enough for non-Linux job-driven collection because a queued job does not yet say:

- which container should be inspected
- which runtime should be used
- which Kubernetes scope should be collected
- which namespace should be targeted
- which cluster/context hint the operator intended

Today those values must be pre-baked into the agent host environment, which creates three problems:

1. The queued job is not self-describing.
2. The UI cannot explain exactly what will be collected.
3. One-registration-per-source becomes more limiting than it needs to be.

## Requirements

The next contract should:

1. preserve the current deterministic job lifecycle
2. keep Linux jobs simple
3. make container and Kubernetes jobs self-describing
4. avoid arbitrary command execution or generic parameter blobs
5. keep capability gating mostly artifact-family-based
6. support a future move toward multiple execution scopes per logical source
7. stay compatible with push-first collection, not replace it

## Current callers

The main callers for this design are:

- SignalForge Sources UI and operator APIs
- `POST /api/sources/[id]/collection-jobs`
- `GET /api/agent/jobs/next`
- `signalforge-agent` job runner
- `signalforge-collectors` family-specific scripts

## Design A: Source-Scoped Defaults Only

### Shape

Keep jobs as they are. Add a typed default collection block to `Source`, for example:

```ts
type SourceCollectionDefaults =
  | { kind: "linux_host" }
  | {
      kind: "container_target";
      runtime?: "podman" | "docker";
      container_ref: string;
    }
  | {
      kind: "kubernetes_scope";
      scope_level: "cluster" | "namespace";
      namespace?: string;
      kubectl_context?: string;
      cluster_name?: string;
      provider?: string;
    };
```

Jobs continue to carry only `artifact_type`, and the agent resolves runtime details from the bound source.

### What it hides

- no job override path
- no job payload expansion
- no new agent route fields

### Trade-offs

This is the smallest possible change, but it keeps too much hidden in source state. It is acceptable if every source truly maps to one fixed execution target, but it breaks down quickly for:

- multiple containers on one host
- one Kubernetes source used for both cluster and namespace collection
- operators who want per-job scope changes without editing the source

This is too conservative for the next real step.

## Design B: Typed Job-Scoped Collection Parameters

### Shape

Add an explicit typed collection block to `CollectionJob`, with optional source defaults that can be copied forward at create time.

```ts
type CollectionScope =
  | { kind: "linux_host" }
  | {
      kind: "container_target";
      runtime?: "podman" | "docker";
      container_ref: string;
      host_hint?: string;
    }
  | {
      kind: "kubernetes_scope";
      scope_level: "cluster" | "namespace";
      namespace?: string;
      kubectl_context?: string;
      cluster_name?: string;
      provider?: string;
    };
```

Recommended rules:

- `Source` may store optional `default_collection_scope`
- `POST /api/sources/[id]/collection-jobs` may accept an optional typed `collection_scope`
- server validates that the scope shape matches the source `expected_artifact_type`
- server stores the resolved scope on the job
- `GET /api/agent/jobs/next` includes `collection_scope` in each job summary
- `signalforge-agent` maps `collection_scope` to collector env vars or CLI args

### Example

```json
{
  "request_reason": "collect namespace drift after deploy",
  "collection_scope": {
    "kind": "kubernetes_scope",
    "scope_level": "namespace",
    "namespace": "payments",
    "kubectl_context": "oke-prod",
    "cluster_name": "prod-eu-1",
    "provider": "oke"
  }
}
```

### What it hides

- the agent still owns local runtime invocation details
- the UI does not need to understand collector shell syntax
- capabilities remain tied to artifact family instead of exploding into per-target strings

### Trade-offs

This is the best bridge design.

It makes jobs self-describing, keeps Linux simple, and avoids a premature full execution-scope model. It does not solve one-registration-per-source forever, but it removes the most painful hidden-state problem without forcing a deeper source hierarchy immediately.

This is the recommended next implementation path.

## Design C: First-Class Execution Scope Resources

### Shape

Introduce a child resource under `Source`, for example `ExecutionScope`, and bind registrations and jobs to that child instead of the source alone.

```ts
type ExecutionScope =
  | {
      id: string;
      source_id: string;
      artifact_type: "linux-audit-log";
      kind: "linux_host";
    }
  | {
      id: string;
      source_id: string;
      artifact_type: "container-diagnostics";
      kind: "container_target";
      runtime?: "podman" | "docker";
      container_ref: string;
    }
  | {
      id: string;
      source_id: string;
      artifact_type: "kubernetes-bundle";
      kind: "kubernetes_scope";
      scope_level: "cluster" | "namespace";
      namespace?: string;
      kubectl_context?: string;
      cluster_name?: string;
      provider?: string;
    };
```

Jobs would then target `execution_scope_id`, and registrations could eventually be scoped more precisely than the top-level source.

### What it hides

- future multi-scope complexity behind a deeper model
- clearer path for multiple registrations under one logical target

### Trade-offs

This is the cleanest long-term architecture, but it is too large for the immediate next slice. It would touch:

- source creation and editing
- registration model
- jobs/next gating
- agent identity
- UI information architecture

It is the likely eventual direction if Kubernetes or mixed-scope execution becomes core product behavior, but it should not be the first move.

## Comparison

Design A is the lightest, but it keeps the real problem hidden and does not improve operator clarity enough.

Design C is the deepest and most future-proof, but it is more architecture than the next slice needs.

Design B is the best fit now because it:

- fixes the hidden-state problem directly
- keeps the current source and registration model intact
- creates a clean migration path toward Design C later
- gives the UI and agent a shared, typed, inspectable contract

## Recommendation

Implement Design B next.

More specifically:

1. Add `default_collection_scope_json` to `Source`.
2. Add `collection_scope_json` to `CollectionJob`.
3. Extend source creation and editing to define family-matching defaults.
4. Extend job creation to accept optional typed overrides.
5. Extend `jobs/next` summaries to include the resolved scope.
6. Update `signalforge-agent` to map the typed scope to collector invocation.
7. Keep capability gating at the artifact-family layer for now.

## Guardrails

Do not accept an untyped free-form parameter bag.

Do not let jobs specify arbitrary commands, shell fragments, or raw collector arguments.

Do not use this slice to introduce write or remediation permissions.

Do not silently assume one source should map to every possible Kubernetes scope forever.

## Suggested Phase 9 implementation slices

### Slice 9a: Contract and storage

- add typed `collection_scope` schema
- add DB columns for source defaults and job-resolved scope
- add validation helpers

### Slice 9b: Operator APIs and UI

- allow source defaults to be set and displayed
- allow job create override for non-Linux families
- show the resolved scope in Sources and job detail surfaces

### Slice 9c: Agent plumbing

- include `collection_scope` in `jobs/next`
- map scope fields to collector env vars or arguments
- improve logs so the claimed target/scope is explicit

### Slice 9d: Review whether Design C is now justified

- if one logical target now needs multiple concurrent registrations or scopes, promote execution scopes to a first-class resource
- if not, keep the simpler bridge design

## Short recommendation for the next thread

Start with Design B: typed job-scoped collection parameters on `CollectionJob`, with optional source defaults. Treat first-class execution scopes as a later promotion only if real usage proves the bridge model too small.
