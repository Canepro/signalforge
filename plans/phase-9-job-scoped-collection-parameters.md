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
8. make agent and collector integration easy enough that operators do not need to pre-bake per-job target state into host-local environment by hand

## Current callers

The main callers for this design are:

- SignalForge Sources UI and operator APIs
- `POST /api/sources/[id]/collection-jobs`
- `GET /api/agent/jobs/next`
- `signalforge-agent` job runner
- `signalforge-collectors` family-specific scripts

## Agent and collector integration requirement

This phase is not only a data-model cleanup. It must also improve the operator and execution experience.

The intended outcome is:

- a queued job is self-describing
- `signalforge-agent` can map the typed job scope directly to collector invocation
- `signalforge-collectors` can consume a stable, documented set of family-specific inputs
- operators do not need to manually set or change per-job environment like:
  - `SIGNALFORGE_CONTAINER_REF`
  - `SIGNALFORGE_CONTAINER_RUNTIME`
  - `SIGNALFORGE_KUBERNETES_SCOPE`
  - `SIGNALFORGE_KUBERNETES_NAMESPACE`
  - active `kubectl` context assumptions

For this phase to count as complete, the typed scope must be easy to use in practice, not only present in the API.

That means the implementation slice should include:

1. server-side typed scope validation and job persistence
2. `jobs/next` returning the resolved scope
3. `signalforge-agent` mapping the typed scope to collector env vars or CLI flags
4. documented collector input mapping for each supported artifact family
5. at least one simple end-to-end operator path showing how a source/job becomes a concrete collector run without ad hoc host-local prep

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
- collector-side mapping should be documented as part of the same slice so agent and collector integration stays explicit

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
7. Document the agent-to-collector mapping and the operator flow for Linux, container, and Kubernetes jobs.
8. Keep capability gating at the artifact-family layer for now.

## Preferred deployment model

For job-driven collection, the preferred deployment model is:

- one `signalforge-agent` product
- deployed as a long-running, always-on service
- running near the execution surface
- managed by the local init or platform, not by an operator shell session

That means:

- Linux and WSL: first-class deployment is a hardened `systemd` service on the target host
- container environments: first-class deployment is still a host-resident service on the container runtime host, or on a dedicated nearby runner with explicit runtime access
- Kubernetes environments: keep push-first as the honest default until the scoped job contract is complete; when job-driven Kubernetes becomes first-class, prefer a dedicated cluster-side runner with explicit RBAC over a human workstation with ambient `kubectl` context

This keeps the current control-plane model simple, keeps the agent warm and ready to claim jobs, and avoids coupling collection to a human login session, cron glue, or a temporary CI runner.

## Security posture for the preferred model

The preferred deployment model above is only acceptable if it is deployed with explicit least-privilege controls.

### Baseline controls

- outbound-only connection from the agent to SignalForge over HTTPS
- source-bound agent token loaded from a root-controlled file or service credential, not passed on the command line
- dedicated local service identity for the agent
- explicit capability advertisement based on real local readiness
- explicit runtime access only for the artifact families that host should collect

### Linux and WSL service baseline

Use a dedicated service user by default. A `DynamicUser=` setup from [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) is attractive for tighter isolation, but it is not the safe default if the agent must read fixed kubeconfig files, talk to a container runtime socket, or join a local group such as `docker`. Prefer a static dedicated account with the minimum required file and group access, and then add `systemd` hardening such as:

- `NoNewPrivileges=yes`
- `PrivateTmp=yes`
- `ProtectSystem=strict`
- `ProtectHome=read-only` or a narrower file layout
- `CapabilityBoundingSet=` reduced to the minimum required set
- `RestrictAddressFamilies=` limited to the families actually needed

Where the host does not need container-runtime or kubeconfig access, `DynamicUser=` can still be used as an optional tighter profile.

### Container runtime access

Container job support should not imply blanket host privilege. If the agent needs Docker or Podman access, treat that as an explicit higher-trust deployment mode and document it accordingly. Runtime socket access must be deliberate, reviewable, and limited to the hosts that actually need `container-diagnostics`.

### Kubernetes access

Do not treat a human workstation kubeconfig or ambient `current-context` as the preferred production model. The Kubernetes docs on [configuring access to multiple clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/) make it clear that `kubectl` contexts are mutable client-side state. The agent should use an explicit kubeconfig path plus explicit context selection or a dedicated cluster-side identity. For any future in-cluster runner, use scoped RBAC and container hardening consistent with the Kubernetes guidance on [security contexts](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).

## Not the preferred model

These may exist for demos, debugging, or one-off use, but they are not the preferred Phase 9 operator model:

- operator laptops
- ad hoc `signalforge-agent once` as the normal path
- cron wrappers as the primary deployment form
- generic bastions with changing local state and shell context
- Kubernetes collection that depends on whichever `kubectl` context happens to be active for a human user

## Cross-repo implementation checklist

This checklist is the source of truth for the actual Phase 9 implementation. Do not treat the server-side API work alone as Phase 9 complete.

### Repo 1: `signalforge`

- [x] Add typed `CollectionScope` validation helpers.
- [x] Add `default_collection_scope_json` to `Source`.
- [x] Add `collection_scope_json` to `CollectionJob`.
- [x] Extend source create and update routes to validate family-matching defaults.
- [x] Extend job create route to accept typed overrides and persist the resolved scope.
- [x] Return resolved `collection_scope` from `GET /api/agent/jobs/next`.
- [x] Publish the updated HTTP contract and JSON schemas.
- [x] Add SQLite and Postgres storage coverage for the typed scope contract.
- [ ] Run live Postgres parity for the new scope columns in an environment with a real Postgres URL.
- [ ] Update Sources UI to display and edit defaults and to show the resolved job scope clearly.

### Repo 2: `signalforge-agent`

- [ ] Parse `collection_scope` from `jobs/next`.
- [ ] Map `linux_host` scope directly to the Linux collector path with no extra operator input.
- [ ] Map `container_target` scope to explicit collector inputs instead of relying on pre-set process-local environment.
- [ ] Map `kubernetes_scope` scope to explicit collector inputs instead of relying on ambient `kubectl` context alone.
- [ ] Make the claimed scope visible in agent logs so support/debugging is self-explanatory.
- [ ] Keep capability advertisement at the artifact-family layer unless a narrower scope-capability split is deliberately introduced.
- [ ] Add tests for each scope kind and for invalid/missing scope handling.
- [ ] Ship a first-class hardened `systemd` service form for the always-on host deployment path.
- [ ] Support loading the agent token from a root-controlled file or service credential, not only plain environment export from an operator shell.
- [ ] Support explicit kubeconfig path and context selection for Kubernetes scope handling.
- [ ] Document least-privilege deployment modes separately for Linux-only, container-capable, and Kubernetes-capable hosts.

### Repo 3: `signalforge-collectors`

- [ ] Accept a stable, documented input mapping for each supported scope kind.
- [ ] Keep the Linux collector path unchanged except for explicit no-op support of `linux_host`.
- [ ] Add documented container collector inputs for `runtime`, `container_ref`, and optional `host_hint`.
- [ ] Add documented Kubernetes collector inputs for `scope_level`, `namespace`, `kubectl_context`, `cluster_name`, and `provider`.
- [ ] Remove any requirement that operators manually pre-bake per-job family target state into host environment for the supported job-driven path.
- [ ] Add examples showing push-first and job-driven invocation for container and Kubernetes collection.
- [ ] Keep collector inputs explicit enough that the agent does not have to rely on a mutable shell session or ambient `kubectl current-context`.

### Docs and drift control

- [x] Document the local Postgres parity helper in beginner-facing docs, not only migration policy docs.
- [x] Make Phase 8 branch reality explicit in README, docs, and plans.
- [ ] Add a dedicated operator-facing document for job-scoped collection parameters once the agent and collector mapping is implemented.
- [x] Add a dedicated operator-facing document for the preferred `signalforge-agent` deployment model and security baseline in `signalforge` so the cross-repo stance does not live only in thread history.
- [ ] Add a sibling-repo handoff note linking the exact SignalForge, agent, and collector changes that shipped together.

### Validation gates

- [ ] `signalforge`: targeted API, repository, parity, and typecheck validation pass.
- [ ] `signalforge-agent`: family-aware scope mapping tests pass.
- [ ] `signalforge-collectors`: documented and tested invocation examples for Linux, container, and Kubernetes.
- [ ] At least one end-to-end operator flow is exercised for:
  - Linux host job
  - container target job
  - Kubernetes namespace or cluster-scoped job

## Partial completion note

The current branch has already completed the first server-side portion of this phase:

- typed `CollectionScope` contract exists in `signalforge`
- source defaults and job overrides are persisted
- `jobs/next` returns the resolved scope
- API docs, schemas, and targeted tests are updated

Phase 9 is **not** complete until the agent and collectors consume the same typed scope contract and the end-to-end operator path is documented and validated.

## Definition of done

Phase 9 is done only when all of the following are true:

1. a queued non-Linux job is self-describing in SignalForge
2. `signalforge-agent` can run that job without hidden per-job host-local prep
3. `signalforge-collectors` accepts the mapped typed inputs cleanly
4. operators can see what will be collected before the job runs
5. the preferred deployment form and security posture are documented well enough that operators do not default back to laptops or ambient shell context
6. the cross-repo flow is documented well enough that a future thread can pick it up without reconstructing intent from chat history

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
