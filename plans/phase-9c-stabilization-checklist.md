# Phase 9c Stabilization Checklist

This checklist is the post-implementation gate for the Phase 9c frontend redesign.

Use it after the operator-workstation redesign is merged locally and before treating the work as preview-ready or production-ready.

Primary design source of truth:

- [`phase-9c-frontend-operator-workstation-polish.md`](./phase-9c-frontend-operator-workstation-polish.md)

## Goal

Freeze the redesign into a controlled ship gate:

- validate the redesigned product in a real preview environment
- catch any remaining interaction or layout regressions
- prevent new one-off UI drift while Phase 9c settles

## Repo Validation

These checks must stay green after any Phase 9c follow-up:

- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] targeted browser verification against local dev or preview

Local browser script currently used during implementation:

- `cd /tmp/signalforge-ui-verify && node check.js`

That check currently covers:

- dashboard desktop
- request-collection modal
- run detail
- compare with implicit baseline
- compare with explicit baseline
- compare with missing baseline
- Sources login, list, new, and detail
- mobile navigation dialog close and focus containment

## Review Gate

Before merge or release signoff, validate a real browser session against the chosen review surface. Use ACA or local by default. If you intentionally created a Vercel preview, validate that preview too.

- [ ] review surface is available for the current change
- [ ] desktop Chrome or Edge review completed
- [ ] mobile Safari-class or Chrome mobile review completed
- [ ] no important action is icon-only or hover-only
- [ ] no dead controls, placeholder nav items, or inert affordances remain

## Real-Browser UX Checks

### Dashboard

- [ ] run table is visible high on the page and reads as the primary work surface
- [ ] `Attention queue` feels secondary but useful, not filler
- [ ] `Request collection`, `Compare latest`, and `How to collect` have clear hover, focus, active, and disabled states
- [ ] no unexplained dead space remains in the first screen

### Request Collection

- [ ] modal width and spacing feel deliberate on desktop
- [ ] live-source cards are clearly selectable
- [ ] selection state is obvious visually and semantically
- [ ] scope override controls read as first-class operator inputs, not advanced metadata

### Run Detail

- [ ] target identity is the first thing operators see
- [ ] top actions are labeled and obvious
- [ ] metadata reads as compact context, not a chip wall
- [ ] no hydration warnings or client-side re-render glitches appear in the browser console

### Compare

- [ ] automatic baseline selection is understandable without query-string knowledge
- [ ] explicit baseline switching is discoverable
- [ ] missing-baseline state is useful and not a dead end
- [ ] evidence delta remains legible even when findings drift is small

### Sources

- [ ] sign-in screen matches the redesigned product quality bar
- [ ] list, detail, and new-source screens feel like the same design system as dashboard and runs
- [ ] create and request flows do not bury important context in sidebars or microcopy

### Shell and Mobile

- [ ] mobile navigation opens as a proper dialog
- [ ] keyboard close works with `Escape`
- [ ] backdrop click closes the drawer
- [ ] focus stays trapped inside the mobile drawer while open

## Interaction Contract Checks

These are the shared UI rules Phase 9c should now enforce:

- [ ] primary, secondary, ghost, and icon buttons all have visibly different states for rest, hover, focus, active, and disabled
- [ ] selectable cards and table rows feel interactive without excessive motion
- [ ] severity colors are reserved for severity, not generic emphasis
- [ ] text does not regress back into widespread 9px or 10px UI copy

## Exit Criteria

Phase 9c can be treated as stabilized when all of the following are true:

- [ ] repo validation stays green
- [ ] preview gate checks are completed
- [ ] real-browser UX checks are completed
- [ ] no browser console or hydration errors remain in core flows
- [ ] no additional broad redesign work is opened without updating the Phase 9c source-of-truth plan

## What Playwright Needs To Work Better Here

The current local browser verification was useful, but the environment still had constraints. For stronger automation, we want:

- a browser runtime with all required shared libraries so Chromium can run directly
- a Playwright MCP session that can install or launch a browser reliably without timing out
- a pointer-capable desktop browser context where `(hover: hover)` and `(pointer: fine)` are actually true
- stable seeded data or a deterministic fixture route for dashboard, compare, and Sources flows
- a preview URL that is directly reachable by browser automation, or a temporary share link when preview protection is enabled

Those improvements would let browser automation validate real desktop hover states and reduce the need for fallback checks against compiled CSS.
