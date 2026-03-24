# SignalForge MVP Plan

> **Historical context — not current status.** See `plans/current-plan.md` for what is implemented now.

## Product

**SignalForge**  
Infrastructure Diagnostics

SignalForge is an evidence-to-findings platform for infrastructure diagnostics.
It ingests evidence artifacts, normalizes them through artifact-specific adapters,
runs deterministic analysis plus model-assisted explanation, and produces
structured reports for operators.

This is not a feature inside `signalforge-collectors`.

## Repo Boundary

SignalForge lives in its own repo:

- product repo: this repository (your `signalforge` checkout)
- collector/source repo: [Canepro/signalforge-collectors](https://github.com/Canepro/signalforge-collectors)
- reference architecture only: [Canepro/pipelinehealer](https://github.com/Canepro/pipelinehealer)

`signalforge-collectors` remains part of the collection plane. It produces artifacts.
SignalForge consumes those artifacts. The coupling point is the artifact format,
validated through versioned fixtures and tests.

## Current Goal

Build a correctness-first diagnostics product for Linux/WSL audit logs now,
while preserving the architecture needed to extend later to:

- container diagnostics
- Kubernetes support bundles
- Terraform plans
- CI failure logs
- other agent callers

## Core Principles

- deterministic-first analysis
- read-only diagnostics
- backend is channel-agnostic
- dashboard first
- no external chat adapters in v1
- no multi-agent orchestration in v1
- no Design C selective tool loop unless later evidence justifies it

## Architecture

SignalForge is organized around three planes.

### 1. Collection Plane

External tools produce artifacts. SignalForge does not own collection in the MVP.

Examples:

- `first-audit.sh` output from `signalforge-collectors`
- future container/k8s collectors
- future CLI or scheduled uploads

### 2. Analysis Plane

SignalForge core logic:

1. detect artifact type
2. select adapter
3. strip transport noise
4. parse sections / normalize evidence
5. detect environment
6. classify expected noise
7. extract deterministic pre-findings
8. detect incomplete evidence
9. call LLM once for explanation and prioritization
10. validate strict report schema
11. persist artifact + run

### 3. Consumer Plane

Consumers of the analysis output:

- dashboard
- API clients
- local CLI
- future agent callers
- future chat surfaces

## Adapter Model

Adapters isolate artifact-specific logic.

Current adapter:

- `linux-audit-log`

Future adapters:

- `wsl-audit-log` if split becomes useful
- `container-diagnostics`
- `kubernetes-bundle`
- `terraform-plan`
- `ci-failure-log`

Everything outside adapters should remain artifact-agnostic.

## Trigger Model

SignalForge distinguishes these actions:

### Reanalyze Existing Artifact

Use the same stored evidence, rerun analysis logic and/or model.

### Collect Fresh Evidence

Go back to the target system through a collector and produce new evidence.

### Compare Runs

Diff two completed runs and show drift.

These must stay separate in the product. A generic "refresh" action is too vague.

## Data Model

SignalForge persists immutable artifacts and separate analysis runs.

### Artifacts

- immutable raw content
- deduped by `content_hash`
- have `artifact_type`
- have original artifact metadata

### Runs

- reference an artifact
- carry per-run submission metadata like filename/source type
- store structured report output
- support future reanalysis via `parent_run_id`

## Severity and Noise Policy

Phase 1 policy is strict:

- deterministic severity is the source of truth
- deterministic noise classification is the source of truth
- model explains findings and prioritizes actions
- model does not invent findings or override noise classes

## LLM Provider Strategy

Provider support is env-driven and backend-only.

Current supported providers:

- OpenAI direct
- Azure OpenAI Responses

Provider selection stays behind a small provider layer so additional providers can
be added later without changing analyzer behavior.

## Locked UI Direction

These design choices are approved.

### Home Screen

Base direction: Stitch Image #2

Required traits:

- table-first
- operator-first
- light theme
- calm gray-blue palette
- KPI row
- recent runs table as dominant element
- upload action
- muted "Collect Fresh Evidence" affordance
- compact supporting charts only

### Run Detail

Base direction: Stitch Image #4

Required traits:

- top 3 actions now
- findings table as dominant element
- suppressed noise panel collapsed by default
- evidence excerpts clearly visible
- run metadata panel
- severity counters and actions in top strip

### Copy Direction

Use:

- Upload Artifact
- Collect Fresh Evidence
- Reanalyze Artifact
- Compare to Previous
- Suppressed Noise
- Environment Context
- Top Actions Now
- Run Metadata
- Evidence Excerpt

Avoid:

- Insights
- Intelligence
- Assistant
- Magic
- AI Summary
- Smart anything

## Fixtures

These fixture logs are mandatory reality anchors (paths relative to a [signalforge-collectors](https://github.com/Canepro/signalforge-collectors) checkout):

- `examples/sample_audit.log`
- `server_audit_20251102_231019.log`
- `server_audit_20251102_232137.log`
- `server_audit_20260320_193559.log`

Copied fixture assets live under `tests/fixtures/` in this repo (see [`tests/fixtures/README.md`](../tests/fixtures/README.md)).

## Phased Roadmap

## Phase 1a

Analyzer core only.

Deliverables:

- adapter interface
- `linux-audit-log` adapter
- deterministic parser pipeline
- strict schemas
- single LLM call for explanation/prioritization
- deterministic fallback
- fixture-driven tests
- golden expectations
- local analyzer entrypoint

Status: implemented

## Phase 1b

Minimal persistence and API layer.

Deliverables:

- artifacts table
- runs table
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/[id]`
- `GET /api/runs/[id]/report`
- route-level tests
- provider abstraction for OpenAI and Azure OpenAI
- green typecheck

Status: implemented

## Phase 2

Dashboard UI.

Deliverables:

- dashboard home page
- run detail page
- reusable UI components
- upload affordance
- run list view
- findings table view
- suppressed noise panel
- metadata panels

Status: next

## Phase 3

Diff, reanalysis, and optional extensions.

Deliverables:

- compare view
- reanalyze flow
- CLI submit helper
- export polish
- optional chat
- optional Design C evaluation

Status: deferred

## Acceptance Criteria by Phase

### Phase 1a

- deterministic analysis is correct on fixtures
- fallback report is valid when LLM is unavailable
- golden tests pass

### Phase 1b

- API and persistence work
- duplicate artifact reuse preserves per-run metadata
- route tests pass
- `bun test` passes
- `bun run typecheck` passes

### Phase 2

- home dashboard renders real runs
- run detail renders real findings and metadata
- UI follows locked visual direction
- no chat/admin-shell drift

## Current Backend Baseline

As of this plan snapshot:

- analyzer core is implemented
- persistence is implemented
- API routes are implemented
- OpenAI direct support is implemented
- Azure OpenAI support is implemented
- tests pass
- typecheck passes

The next approved work is Phase 2 UI only.

## Explicit Non-Goals for MVP

- no broad automation
- no live system mutation
- no omnichannel chat
- no remediation engine
- no multi-provider routing/fallback
- no collector execution inside SignalForge
- no premature generic platform framework

## Decision on Design C

Design C means a more agentic selective section-fetching loop.

It is deferred until there is concrete evidence that the current
deterministic-first single-call approach is insufficient on:

- quality
- token cost
- extensibility

Until then, deterministic-first remains the approved default.
