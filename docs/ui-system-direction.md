# UI System Direction

This note records the current UI-system decision for SignalForge so future work
does not rely on chat memory.

## Current State

SignalForge does **not** currently use `shadcn/ui`.

The repo already has a small local design system built from:

- theme tokens and component classes in [`src/app/globals.css`](../src/app/globals.css)
- product-specific composite components in [`src/components/`](../src/components)

Examples already in active use:

- `sf-panel`
- `sf-kicker`
- `sf-btn-primary`
- `sf-btn-secondary`
- `sf-btn-ghost`
- `sf-field`

The run detail, dashboard, compare view, modals, and sources surfaces all rely
on these local primitives today.

## Why Shadcn Was Not Used

There is no `shadcn/ui` setup in this repo today:

- no `components/ui`
- no `@radix-ui/*`
- no `class-variance-authority`
- no `tailwind-merge`
- no shared `cn()` utility

So the issue is not that `shadcn/ui` was adopted and later removed. It simply
was never installed or established as the repo standard.

## Decision

SignalForge should **not** do a blind full migration to `shadcn/ui` from the
current state.

That would create churn across a working custom system without solving the
actual product gap, which is operator-story quality and artifact-aware summary
presentation.

The recommended direction is:

1. keep the current SignalForge visual language and token system
2. treat the existing `sf-*` primitives as the current system of record
3. only introduce `shadcn/ui` deliberately, where it clearly replaces a weak or
   missing primitive instead of creating a second UI language

## Recommended Adoption Model

If `shadcn/ui` is introduced, use it as a **primitive source**, not as a second
page-level styling system.

Good candidates:

- dialog / sheet primitives
- dropdown menu
- popover
- tabs
- tooltip
- command palette
- chart wrappers if they materially improve reuse

Bad candidates:

- wholesale restyling of existing screens just to match `shadcn` defaults
- mixing `shadcn` page aesthetics with existing `sf-*` styling ad hoc
- introducing `components/ui` beside the current system without mapping how it
  relates to `sf-*` primitives

## Practical Rule For Future Work

For SignalForge UI changes:

- preserve the existing product visual language
- prefer strengthening the local system first
- adopt `shadcn/ui` only when it removes local UI debt or fills a missing
  primitive cleanly
- do not import `shadcn/ui` components with default styling and treat them as
  the new visual baseline without an explicit repo decision

## What This Means For The Findings Redesign

The findings and run-detail redesign should start with:

- a stronger operator-summary model
- reusable artifact-aware summary modules
- charts only for evidence that is naturally quantitative

That work does **not** require a full `shadcn/ui` migration.

If specific primitives are needed while doing that redesign, we can introduce
them intentionally and style them to match SignalForge.

## Revisit Trigger

Revisit this decision if:

- the local `sf-*` primitives become hard to maintain
- accessibility gaps keep reappearing in custom interactive components
- we want a formal component library with documented variants and tests
- multiple pages start rebuilding the same primitives in incompatible ways
