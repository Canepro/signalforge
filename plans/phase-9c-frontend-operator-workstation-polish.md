# Phase 9c Design: Frontend Operator Workstation Redesign and Interaction Polish

> Status: planned follow-on. The initial frontend audit for this phase is complete, and the first implementation pass should prioritize the dashboard, run detail, compare, and global shell before carrying the same system into Sources and collection flows.

## Why this exists

SignalForge's current branch is functionally strong, but the frontend is still the weakest part of the product experience.

The biggest problems are not missing features. They are presentation and interaction drift:

- the dashboard still spends too much first-screen space on summary chrome instead of the operator work surface
- run detail and compare hide important actions behind icon-heavy or low-discoverability controls
- sources and collection flows compress meaningful scope decisions into dense, modal-heavy UI
- too much metadata is rendered as pills or micro-labels, which makes the product feel cheaper and more generic than it is
- interaction states are inconsistent across nav, buttons, rows, cards, and dialogs

This phase exists to make SignalForge feel like a deliberate operator workstation rather than a stitched-together internal dashboard.

## Design intent

Phase 9c is not a brand reset and not a decorative polish pass.

Keep the existing product constraints:

- operator-first
- light theme by default
- calm gray-blue palette
- severity colors reserved for severity
- no chatbot-first layout
- no marketing-site patterns

The target posture is:

- clearer hierarchy
- denser signal
- fewer filler cards
- fewer pills
- stronger hover, focus, and selection affordances
- readable type without widespread 9px and 10px UI copy
- restrained motion that reinforces structure rather than calling attention to itself

## Core implementation changes

### 1. Shared UI system cleanup

Land a shared presentation layer before page-specific polish spreads further.

Required work:

- add semantic warning and danger tokens so warning and critical evidence surfaces no longer fall back to neutral styling
- normalize button, icon-button, nav-item, row, and selectable-card interaction states
- standardize border strength, radius, shadow, and transition timing
- set a typography floor so normal body and metadata text no longer rely on widespread 9px and 10px sizing
- reduce chip overuse by moving low-priority metadata back into structured rows or compact context blocks

Important constraint:

- no public HTTP/API/schema change is required for this phase
- internal UI interfaces may change where shared component props or page composition need to be simplified

### 2. Dashboard and shell redesign

Make the dashboard feel immediately data-first.

Required direction:

- the run table or equivalent operator queue must be visually dominant and visible earlier than summary cards
- KPI cards become supporting context rather than the first-screen destination
- the right rail must earn its space; remove or merge low-value summary-of-summary surfaces
- keep `Collection Pulse`, but align its chrome and interaction language with the rest of the app
- remove unfinished-looking shell affordances such as disabled placeholder navigation
- mobile navigation must behave like a real dialog with focus handling and keyboard dismissal

Acceptance target:

- the desktop landing view reads as an operator queue with support surfaces, not as a card grid with a table below it

### 3. Run detail and compare redesign

Make run analysis and drift review easier to scan and easier to operate.

Required direction:

- rebuild the run-detail top section around target identity, run context, and action clarity instead of chip-heavy metadata
- replace icon-only or low-discoverability actions with labeled or clearly grouped controls where that improves operator flow
- keep the findings table as the dominant working surface
- simplify the findings overview and filter band so it feels analytical rather than decorative
- make compare baseline selection understandable without requiring the operator to infer `?against=` semantics from copy
- show useful compare empty states when there is no same-target baseline yet
- make evidence delta visibly valuable even when finding drift is unchanged

### 4. Sources and collection flow cleanup

Carry the same visual and interaction system into Sources so the product does not split into two frontend standards.

Required direction:

- redesign request-collection flows so source choice and typed collection scope read like first-class operational decisions
- remove or demote static reference sidebars where inline contextual help is enough
- promote `target_identifier`, default scope, and resolved job scope into explicit, readable UI instead of “advanced metadata”
- keep collection guidance honest about the external collector and agent boundary

## Validation and acceptance

Implementation validation should combine repo checks with browser verification.

Required repo validation:

- `bun run typecheck`
- targeted tests for any new frontend utility or shared presentation helper introduced by this phase
- targeted build or test follow-on if a component refactor introduces non-trivial logic

Required browser verification:

- dashboard on desktop and mobile
- run detail on desktop and mobile
- compare with implicit baseline
- compare with explicit baseline
- compare with missing baseline
- sources list, detail, and create
- dashboard request-collection flow
- hover, focus, active, and disabled states across nav, row, icon, secondary, and primary controls

Visual acceptance criteria:

- the dashboard shows the work surface above the fold
- main-shell navigation contains no placeholder disabled entries
- warning and critical evidence surfaces are visually distinct and consistent
- run detail materially reduces chip count
- core UI copy is readable without widespread 9px and 10px typography
- pages feel related through the same UI grammar without becoming card-flat
- dead space is reduced by removing low-value filler surfaces, not by stuffing more summary chrome into the same layout
