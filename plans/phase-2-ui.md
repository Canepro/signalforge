# SignalForge Phase 2 UI Spec

> **Historical context — not current status.** Phase 2 shipped; see `plans/current-plan.md` for the live picture.

## Scope

Implement Phase 2 only:

- dashboard home
- run detail page
- reusable UI components needed for those two screens

Do not implement:

- comparison page
- real reanalyze flow
- collectors
- chat
- auth
- scheduling
- provider selection UI
- Design C/tool loop work

## Product Context

SignalForge is an operator-first infrastructure diagnostics product.

It is not:

- a chatbot
- a marketing site
- a generic admin shell
- a flashy AI dashboard

The UI must foreground:

- evidence
- findings
- actions
- metadata

## Locked Design Direction

### Home

Base direction: Stitch Image #2

Key traits:

- light theme
- clean enterprise diagnostics feel
- left navigation
- top bar
- KPI row
- run table as dominant surface
- compact supporting analytics below
- right-side action affordances if useful

### Run Detail

Base direction: Stitch Image #4

Key traits:

- top actions strip
- findings table as dominant surface
- suppressed noise panel collapsed by default
- strong metadata presentation
- evidence excerpts readable and visually distinct

## Visual System

- light theme by default
- neutral gray-blue base palette
- severity colors only for severity:
  - critical: red
  - high: orange
  - medium: amber
  - low: gray
- compact border radius
- strong table dividers
- quiet shadows
- crisp typography
- no purple-heavy palette
- no cyberpunk styling
- no oversized chat area

## Copy Rules

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
- Findings
- Severity

Avoid:

- Insights
- Intelligence
- Assistant
- Magic
- AI Summary
- Smart anything

## Data Sources

Use the existing backend before changing API contracts.

Available routes:

- `GET /api/runs`
- `GET /api/runs/[id]`
- `GET /api/runs/[id]/report`
- `POST /api/runs`

Small backend adjustments are acceptable only if the UI truly needs them.

## Screen 1: Dashboard Home

## Required Areas

### Header / Top Bar

Show:

- product title: `SignalForge`
- subtitle: `Infrastructure Diagnostics`
- search input
- operator/avatar area
- primary action: `Upload Artifact`
- secondary action: `Collect Fresh Evidence`

`Collect Fresh Evidence` should exist visually but be muted/disabled until collectors exist.

### KPI Row

Include:

- Total Runs
- New Critical Findings
- Environments Analyzed
- Suppressed Noise

Suppressed Noise should be framed as a trust metric.

### Recent Runs Table

This is the dominant element on the page.

Columns:

- filename or run name
- artifact type
- source type
- target / hostname if available
- analyzed at
- severity summary
- status

Needs:

- row action or click-through to run detail
- good density and readability
- clear severity/status treatment

### Action Rail / Utility Area

Show UI affordances for:

- Reanalyze Artifact
- Compare to Previous
- Collect Fresh Evidence

They can be disabled or stubbed if not implemented.

### Lower Supporting Area

Compact blocks only:

- Severity Distribution
- Environment Mix
- Diagnostics Feed / recent activity

These should support the main table, not compete with it.

## Screen 2: Run Detail

## Required Areas

### Top Strip

Show:

- Top 3 Actions Now
- severity counters
- Reanalyze button
- Export button

Top actions should read like an operator priority queue, not a marketing banner.

### Run Identity / Metadata Block

Show:

- filename / run title
- artifact type
- source type
- hostname / target
- timestamps
- model used
- run id

### Findings Table

This is the dominant surface on the page.

Columns:

- severity
- issue/category
- evidence excerpt
- impact / recommended action

Requirements:

- severity badges
- readable evidence excerpts
- evidence visually distinct, ideally monospace
- clear spacing and scanability

### Suppressed Noise Panel

Requirements:

- collapsed by default
- count badge
- short explanation for why items were suppressed

### Run Metadata Panel

Show:

- analysis time
- tokens used
- model
- incomplete audit status
- analysis error if present

## Components

Expected reusable components:

- app shell / sidebar
- top bar
- KPI card
- run table
- severity badge
- status badge
- top actions panel
- findings table
- suppressed noise panel
- run metadata panel
- environment banner if useful

Do not overbuild a design system beyond what these screens need.

## Responsive Behavior

Desktop-first is fine, but the UI must still hold together on smaller widths.

Requirements:

- navigation remains usable
- tables remain readable
- metadata sections stack cleanly
- no horizontal chaos on tablet/mobile

## Implementation Guidance

- prefer server-side data fetching or pragmatic Next.js patterns
- keep components inspectable
- keep the backend/API contract stable
- avoid chart-heavy or dashboard-fluff UI
- tables and evidence should dominate

## Acceptance Criteria

- home dashboard renders real runs
- upload control is present in the UI
- run list is the dominant home-page element
- run detail clearly shows top actions, findings, suppressed noise, and metadata
- severity styling is consistent
- copy follows the approved terms
- `bun test` passes
- `bun run typecheck` passes
- no Phase 3 work has started

## Explicit Deferrals

- comparison page
- live reanalyze flow
- fresh collection flow
- chat
- auth
- provider switching UI
- scheduling
- collectors
