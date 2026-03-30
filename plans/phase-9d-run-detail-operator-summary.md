# Phase 9d Design: Run Detail Operator Summary and Findings Redesign

> Status: planned follow-on. This phase narrows the frontend follow-up after Phase 9c and the broader operational-diagnostics work in Phase 9b. It exists to make run detail tell a stronger operator story from evidence that SignalForge already collects.

## Why this exists

SignalForge now collects richer operational evidence across all three artifact
families, but the run-detail experience still makes operators read too much
before they understand the current state.

The current page is strongest at:

- target identity
- top actions
- detailed findings
- raw evidence-backed metadata

It is weaker at:

- summarizing the most important operational signal first
- visually surfacing quantitative evidence such as pressure or top consumers
- adapting the summary surface to the artifact family
- making it obvious what deserves immediate attention before the findings table

This phase exists to fix that gap without turning the page into dashboard
filler or chart clutter.

## Research-backed findings

This design direction is based on:

- current run-detail implementation in `src/app/runs/[id]/run-detail-client.tsx`
- current findings and evidence presentation components
- the existing evidence-summary builder in `src/lib/run-evidence-presentation.ts`
- the latest real ACA-backed Kubernetes run from OKE
- the local `frontend-review`, `observability-architecture`, and
  `design-system-maintenance` skills

The most important findings are:

1. SignalForge already collects enough evidence to tell a stronger operator
   story, especially for Kubernetes and container diagnostics.
2. The current `RunEvidenceSections` layer is the right architectural hook, but
   it is still mostly cardified text rather than a true summary surface.
3. The findings table remains valuable and should stay the source of truth, but
   it should no longer be the first place an operator must go to understand run
   state.
4. Some evidence is naturally chartable and should be visualized. Other
   evidence is categorical or explanatory and should stay as structured text.
5. A full `shadcn/ui` migration is not the right first move. The repo already
   has an established local UI system. `shadcn/ui` should only be introduced
   selectively as a primitive source where it cleanly removes local UI debt.

## Design intent

The run-detail page should answer these questions in order:

1. What is wrong right now?
2. How bad is it?
3. Where is the pressure or risk concentrated?
4. What should I inspect next?
5. What is the detailed evidence behind that summary?

This means the page should behave less like:

- metadata strip
- summary bullets
- findings cards
- long findings table

And more like:

- run status and target identity
- artifact-aware operator summary
- compact quantitative visuals when the evidence supports them
- short structured callouts for bounded non-quantitative evidence
- findings table
- deeper metadata and suppressed noise

## Explicit non-goals

Do not turn run detail into:

- a generic observability dashboard
- a chart wall
- a prose-heavy incident report
- a separate UI standard from the rest of SignalForge
- a `shadcn/ui` restyle exercise

## Evidence-to-surface rules

### Show as charts when all of these are true

- the evidence is naturally quantitative
- the operator benefits from relative comparison at a glance
- the visual reduces reading load versus equivalent prose
- the chart can stay compact and legible

Examples:

- node CPU and memory percentages
- top pod CPU and memory consumers
- event counts by warning category
- severity or signal distribution
- guardrail coverage counts

### Show as structured callouts when any of these are true

- the evidence is categorical, not numeric
- the operator needs a short diagnosis, not a trend view
- there are only a few important items
- the source evidence is already human-readable

Examples:

- rollout blocked because controller has not observed the latest generation
- workload depends on a pending PVC
- HPA cannot compute a healthy scaling recommendation
- service account token automount on an exposed workload

### Keep in the findings table when

- the issue is specific and evidence-backed
- it needs full `why_it_matters` and `recommended_action`
- it is not useful as a top-level summary item on every run

## Summary module model

The page should move to a reusable artifact-aware summary-module system.

Each module should declare:

- `id`
- `artifactFamilies`
- `priority`
- `title`
- `kind`
  - `stat-grid`
  - `bar-list`
  - `distribution`
  - `callout-list`
  - `table-lite`
- `emptyState`
- `build(run)` or equivalent presentation input

Modules should consume normalized run data and structured finding evidence,
without baking page layout decisions into analyzer code.

## Common run-detail structure

All artifact families should share one page frame:

1. Target identity and run state
2. Operator summary row
3. Artifact-aware summary modules
4. Findings overview and filters
5. Findings table
6. Metadata and suppressed noise

The common frame keeps the product coherent. The modules make the page feel
family-aware instead of generic.

## Recommended first summary modules

### Shared modules

- `RunHealthSummary`
  - severity mix
  - instability / pressure / exposure / identity counts
  - analysis health and incompleteness
- `PriorityCallouts`
  - top 3 operator-relevant conditions with short action-oriented wording

### Linux host

- `HostPressureSnapshot`
  - disk pressure
  - memory pressure
  - pending upgrades
  - recent error volume
- `TopProcesses`
  - top memory or CPU consumers when available

### Container diagnostics

- `ContainerRuntimeHealth`
  - runtime state
  - health state
  - restart count
  - OOMKilled
  - memory guardrail status
- `ContainerResourceSnapshot`
  - CPU and memory when credible one-shot stats exist

### Kubernetes bundle

- `ClusterCapacitySnapshot`
  - node CPU and memory bars
  - low-headroom summary
  - explicit scheduling-pressure callout
- `TopWorkloadConsumers`
  - top pod memory and CPU consumers
- `ClusterGuardrails`
  - HPA count
  - PDB blockers
  - quota coverage or pressure
  - LimitRange coverage
- `WorkloadInstability`
  - rollout blockers
  - unhealthy workload excerpts
  - grouped warning-event categories

## Kubernetes-specific guidance

The current product gap is especially visible on Kubernetes runs.

Example from real OKE validation:

- the artifact contained node memory usage, pod consumers, and a
  `FailedScheduling` warning caused by insufficient CPU
- the findings page surfaced the warning-event symptom more clearly than the
  broader cluster-capacity story

The redesigned operator summary should make these situations obvious without
requiring the operator to read the full findings table.

Minimum deterministic expectations for Kubernetes:

- surface low memory headroom before `MemoryPressure=True`
- surface scheduling pressure with explicit capacity wording
- surface top node and pod consumers in a compact visual form
- show absence of helpful guardrails such as HPAs or quotas when that materially
  affects interpretation

## Shadcn stance for this phase

This phase should preserve the current SignalForge visual language.

Use `shadcn/ui` only if a specific primitive clearly improves implementation
quality or accessibility, for example:

- tabs
- tooltip
- popover
- dialog
- dropdown menu

Do not let `shadcn/ui` become a second styling language on the page.

## Suggested implementation slices

### Slice 1: summary-module contract

- formalize a run-detail summary-module API
- separate chartable evidence from callout evidence
- keep existing page shell intact

### Slice 2: Kubernetes capacity story

- add `ClusterCapacitySnapshot`
- improve scheduling-pressure wording
- add top node and pod consumer summaries

### Slice 3: container runtime story

- elevate runtime health and one-shot resource evidence into stronger summary
  modules

### Slice 4: Linux host pressure story

- add compact pressure and top-process summaries where evidence quality is good

### Slice 5: page cleanup

- simplify the current findings overview band once the new summary layer is in
  place
- reduce duplicated summary chrome

## Acceptance criteria

This phase is successful when:

- an operator can understand the main risk in a run before reading the findings
  table
- charts are only used where they clearly save reading effort
- the summary layer adapts to artifact family without changing the whole page
  structure
- the findings table remains the evidence-backed working surface
- the page feels more useful, not more decorative
- new summary modules are reusable across future artifact families and evidence
  slices

## Validation expectation

Implementation for this phase should include:

- targeted component or helper tests for any new summary-module logic
- `bun run typecheck`
- browser verification of run detail on desktop and mobile for all three
  artifact families
- explicit review of empty and low-signal states so the redesign does not rely
  on fake charts or placeholder chrome
