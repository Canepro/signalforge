# Phase 9c–9d stabilization pass (2026-05)

Operator validation after Phase **9d** run-detail summary and PR **#18** dashboard Operational Watch lanes.

## Repo gates (automated)

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run test:parity` when Postgres is available (`bash scripts/run-postgres-parity-local.sh`)

## Manual browser pass (local or ACA)

### Dashboard (PR #18)

1. Open `/` after submitting runs with scheduling, container runtime, and capacity findings.
2. Confirm **Operational Watch** shows active lanes only when evidence exists (no placeholder metrics).
3. **Scheduling Pressure** — FailedScheduling rows show aggregated event counts in detail.
4. **Runtime & Host Pressure** — container OOM/restart/memory and Linux disk signals appear; OOM copy reads **OOMKilled flagged** (not collection timing).
5. Lane links open the correct run detail.

### Run detail (Phase 9d)

1. **linux-audit-log** — Host Pressure Snapshot; Top Processes when `ps` is present.
2. **container-diagnostics** — Runtime health, resource bars, failure callouts.
3. **kubernetes-bundle** — Capacity snapshot, scheduling pressure stat, top consumers.
4. Compact **Findings table filters** when summary modules are present.
5. Findings table remains the evidence-backed working surface.

### Compare export (follow-on PR)

1. Open `/runs/[id]/compare` with a baseline selected.
2. **Export compare JSON** downloads the same payload as `GET /api/runs/[id]/compare`.
3. **Copy compare JSON** places formatted JSON on the clipboard (with prompt fallback).
4. Buttons stay disabled when **baseline missing**.

### Compare, Sources, mobile

- Compare baseline picker and evidence delta legibility.
- Sources login, list, job form.
- Mobile sidebar nav closes and focus is contained.

## CLI parity

```bash
./scripts/signalforge-read.sh compare <run-id> [--against <baseline-id>]
```

Should match the UI export payload shape.
