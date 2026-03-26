# SignalForge Roadmap

This is the canonical long-lived roadmap for SignalForge.

Use this file for:

- product direction
- completed phases
- active next work
- future phases
- deferred items
- key boundaries and design decisions

Use [`current-plan.md`](./current-plan.md) as the shorter operational snapshot for the repo’s current implemented state.

Historical phase docs in `plans/` remain useful context, but they are not the master roadmap.

For first-time users, start with `README.md` and `docs/getting-started.md` before reading this file.

## Product Vision

**SignalForge**  
Infrastructure Diagnostics

SignalForge is an operator-first evidence-to-findings platform for infrastructure diagnostics.

Current shape:

- ingest evidence artifacts
- analyze them with a deterministic-first pipeline
- use one LLM call for explanation and prioritization
- persist artifacts and runs
- expose results through UI, APIs, and CLI helpers

Long-term direction:

- remain an analysis platform
- accept evidence from external collectors
- support broader evidence types over time:
  - Linux / WSL
  - servers / VMs
  - containers
  - Kubernetes bundles
  - Windows
  - macOS
  - other device/system evidence where a collector can produce artifacts

## Product Boundary

SignalForge should:

- analyze evidence
- persist artifacts and runs
- expose deterministic findings and drift
- support dashboard, API, CLI, and agent/tool consumption

SignalForge should not, in the near model:

- become a privileged SSH / kubectl / docker execution engine
- own broad collector execution inside the app
- implement remediation in the current product scope
- expand into generic fleet management too early

Remediation remains deferred rather than permanently ruled out. If it is ever added, it should be treated as a separate higher-trust capability class from read-only diagnostics and collection.

Reference repos:

- collector/source repo: [Canepro/signalforge-collectors](https://github.com/Canepro/signalforge-collectors)
- execution-plane agent: `signalforge-agent` (sibling repo, not yet published)
- reference architecture only: [Canepro/pipelinehealer](https://github.com/Canepro/pipelinehealer)

Clone locally when working across repositories; script paths are relative to your checkout.

## Completed Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1a | Analyzer core: `linux-audit-log` adapter, deterministic pipeline, fixtures, fallback, one LLM explanation pass | Done |
| 1b | Persistence and API: SQLite/sql.js, artifact/run model, `POST /api/runs`, run detail/report APIs | Done |
| 2 | Dashboard UI: home, run detail, upload flow, operator-first shell | Done |
| 3 | Workflow features: reanalyze, compare UI, CLI submit helper | Done |
| 4 | Findings-quality pass: listener wording, observability labeling, WSL noise suppression, fallback quality | Done |
| 4b | Deeper service identification from `ss` / `users:(...)` and compare stability for listener wording | Done |
| 4c | Fallback quality refinement + repo docs/handoff cleanup | Done |
| 5 | Collector/fresh-evidence architecture planning | Done |
| 5a | Ingestion metadata contract on runs | Done |
| 5b | Target identity alignment: `target_identifier` first, hostname fallback | Done |
| 5c | External submit contract + CLI metadata support | Done |
| 5d | Compare/drift JSON API | Done |
| 5e | CLI read helpers for run/report/compare | Done |
| 5f | API/schema publication for agent integration | Done |
| 6c–6d | Source + CollectionJob + operator APIs, agent execution routes, /sources UI, lease reaper, domain events | Done |
| 6e | signalforge-agent repo: thin external agent (Bun + TypeScript), validated E2E; Sources UI unified layout polish | Done |
| 7a–7b | Storage abstraction (contract + adapters), Postgres backend, `DATABASE_DRIVER` selection, checked-in SQL migrations, `schema_migrations` tracking | Done |
| CI | GitHub Actions: typecheck, test, build + Postgres parity (fresh `postgres:16-alpine`, apply migrations, parity suite). Checked-in migration policy. Upgrade-path test scaffold. | Done |

## Current State

Current supported artifact families:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

Current provider support:

- OpenAI direct
- Azure OpenAI Responses
- deterministic fallback when provider unavailable or misconfigured

Current workflows:

- UI upload
- API upload
- run detail
- reanalyze
- compare (UI + JSON API)
- CLI submit helper
- CLI read helpers
- external reference push collector outside SignalForge

Published contract/docs:

- [`../docs/external-submit.md`](../docs/external-submit.md)
- [`../docs/api-contract.md`](../docs/api-contract.md)
- [`../docs/getting-started.md`](../docs/getting-started.md)
- `../docs/schemas/`

## Current Strengths

- deterministic-first findings
- WSL / non-root noise suppression
- target-aware compare semantics
- programmatic read paths for agents/tools
- clean external collector boundary

## Current Limitations

- broader multi-artifact support is still early, but the current branch now includes first-slice container diagnostics and Kubernetes bundle analysis in addition to Linux
- findings quality is strongest where evidence is explicit
- recommendations remain bounded by collected evidence
- external collector model includes reference push path (`signalforge-collectors`) and job-driven agent (`signalforge-agent`)
- no auth / scheduling yet

## Deployment

The live SignalForge instance is deployed on **Vercel** with a **Neon Postgres** backend. Local development defaults to SQLite.

**Stack:** Next.js (App Router), Bun, TypeScript, React, Tailwind CSS, sql.js/SQLite (local), Postgres/Neon (production), Vitest, GitHub Actions CI.

## Active Next Work

Recommended near-term choices:

1. Use the system with more real submissions and collect friction.
2. Finish the Phase 8 honesty and merge cleanup across README, docs, and plan files so `main` can catch up to branch reality.
3. Land the Phase 9 job-scoped collection-parameter slice across `signalforge`, `signalforge-agent`, and `signalforge-collectors` instead of leaving non-Linux job-driven collection dependent on host-local environment.
4. Continue agent hardening: exponential backoff on network errors, Playwright/browser smoke test for Sources UI, hardened `systemd` service form with secure credential loading, and an explicit preferred deployment stance of always-on service near the execution surface rather than operator laptops or ambient shell context.
5. Plan and implement the next diagnostics-enrichment tranche so SignalForge expands beyond posture-only evidence for containers and Kubernetes, and update the dashboard and findings experience so that richer evidence is visible and useful instead of hidden. Source of truth: [`phase-9b-operational-diagnostics-and-rich-presentation.md`](./phase-9b-operational-diagnostics-and-rich-presentation.md).
6. Add lint to CI.

## Future Phases

These are likely future directions, not commitments.

### Phase 6a: Source + CollectionJob + thin external agent (architecture)

**Design-only (for now):** [`phase-6-source-job-agent-architecture.md`](./phase-6-source-job-agent-architecture.md). SignalForge as **control plane**; thin agent as **execution plane**; `Collect Fresh Evidence` creates jobs; agents poll/claim, run `signalforge-collectors`, upload back. Extends [`phase-5-collector-architecture.md`](./phase-5-collector-architecture.md).

### Phase 6b: Source + CollectionJob API and data contract

[`phase-6b-source-job-api-contract.md`](./phase-6b-source-job-api-contract.md) — normative spec (Source/Job, admin Bearer, source-bound agent tokens, asymmetric lease expiry, events). **Phase 6c** implements the **operator** surface + persistence; **agent** execution routes remain next.

### Phase 6: Real-Usage Hardening

Possible scope:

- more real-artifact evaluation
- targeted findings tuning
- export/read-model polish
- small API ergonomic fixes

### Phase 7: Second Reference Collector Pattern

Possible scope:

- one more external push collector pattern
- still external to SignalForge
- likely container or Kubernetes support-bundle submission pattern

Important:

- do not implement a generalized collector framework first
- prove a second pattern narrowly

### Phase 7: Storage abstraction and multi-backend persistence

[`phase-7-storage-abstraction.md`](./phase-7-storage-abstraction.md) — define a backend-agnostic persistence boundary, preserve SQLite as the default local/self-hosted backend, and add a durable production backend without vendor lock-in. Recommended backend shape: SQLite for local, Postgres for production, optional libSQL later if justified.

Important:

- do not hard-wire the product to one hosted database vendor
- do not let `sql.js` driver types leak through routes/pages/actions
- do not degrade the zero-dependency OSS quickstart

### Phase 8: Second Reference Collector Pattern

Possible scope:

- one more external push collector pattern
- still external to SignalForge
- likely container or Kubernetes support-bundle submission pattern

Phase 8 starts from the hardened single-family base and must first lock: artifact envelope compatibility, the deterministic `evidence_delta` compare model, target-identity scope, and source/registration assumptions.

The first Kubernetes gate is now decided: use a UTF-8 JSON manifest over the existing text ingestion path for `kubernetes-bundle` v1, and defer raw archive support to a separate ingestion/storage phase if it is ever needed.

Important:

- do not implement a generalized collector framework first
- prove a second pattern narrowly

### Phase 9: Source / Target Registration Design

Possible scope:

- define source registration model
- define target/source labels vs stable identifiers
- plan how collectors identify themselves
- design without turning the app into an execution engine
- Phase 9 should explicitly resolve the execution-scope model before multi-scope container/Kubernetes automation work. Phase 8 push-first work can proceed without this change.

### Phase 10: Fresh-Evidence Orchestration

Possible scope:

- controlled “collect fresh evidence” workflows
- likely push-first or hybrid orchestration
- explicit security and trust model required first

### Phase 10b: Operational Diagnostics Enrichment and Rich Presentation

Possible scope:

- richer operational diagnostics for Kubernetes, containers, and hosts
- optional metrics, events, rollout state, node health, and bounded unhealthy-workload log excerpts
- stronger findings and evidence summaries for instability and pressure, not only posture
- dashboard and run-detail enrichment so operators can actually see and use the new evidence

Source of truth:

- [`phase-9b-operational-diagnostics-and-rich-presentation.md`](./phase-9b-operational-diagnostics-and-rich-presentation.md)

### Phase 11+: Broader Artifact Families

Potential future evidence types:

- Kubernetes support bundles
- container diagnostics
- Windows evidence packs
- macOS evidence packs
- broader host diagnostics

These should follow the same pattern:

- collector gathers bytes externally
- SignalForge ingests and analyzes

## Deferred / Non-Goals

Intentionally deferred:

- collectors inside SignalForge
- privileged remote execution from the dashboard
- auth-heavy multi-user expansion before the product boundary is settled
- remediation capabilities in the current product scope
- generalized policy engine
- chat surfaces
- broad fleet-management scope
- premature multi-artifact platform sprawl without contract clarity

## Key Design Decisions

1. Deterministic findings and severity remain the source of truth.
2. LLMs explain and prioritize; they do not invent findings.
3. Artifacts are immutable; runs are separate and can be reanalyzed.
4. Target identity prefers explicit `target_identifier`, then hostname, then artifact fallback only when necessary.
5. Compare is deterministic and target-aware.
6. Collection remains external.
7. Push-based collection is the preferred early pattern.
8. If click-to-collect ships, SignalForge remains a **control plane**; a **thin external agent** performs execution near the target.
9. Prefer a small SignalForge-specific agent (informed by Fleet/Alloy, FleetDM, Argo-style boundaries) over a full RMM stack or greenfield collector platform in early slices.

## Supporting Documents

See these files for more detail:

- [`current-plan.md`](./current-plan.md)
- [`phase-5-collector-architecture.md`](./phase-5-collector-architecture.md)
- [`phase-6-source-job-agent-architecture.md`](./phase-6-source-job-agent-architecture.md) (Phase 6a: architecture)
- [`phase-6b-source-job-api-contract.md`](./phase-6b-source-job-api-contract.md) (Phase 6b: API + data contract)
- [`../docs/external-submit.md`](../docs/external-submit.md)
- [`../docs/api-contract.md`](../docs/api-contract.md)
- historical:
  - [`mvp.md`](./mvp.md)
  - [`phase-2-ui.md`](./phase-2-ui.md)

## How To Use This Roadmap

For a new agent:

1. read `README.md`
2. read `AGENTS.md`
3. read this file
4. read `current-plan.md`
5. only then use older phase docs for context
