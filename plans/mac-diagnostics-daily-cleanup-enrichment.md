# Mac Diagnostics Daily Cleanup Enrichment

Status: proposed implementation plan

## Goal

Make SignalForge reason over local Mac daily cleanup state without creating a
separate cleanup artifact family and without weakening the existing cleanup
automation's local authority.

The desired end state is:

- the daily cleanup script remains the source of truth for cleanup policy,
  deletion boundaries, and report generation
- the Mac collector reads the newest cleanup report when it exists and appends
  bounded metadata-only enrichment to the `mac-diagnostics` artifact
- the `mac-diagnostics` adapter produces deterministic cleanup-aware findings
  and summaries from that enrichment
- SignalForge compare and automation-agent flows can reason over cleanup drift
  using normal Mac runs

## Why this is enrichment, not a new artifact family

The cleanup output describes one aspect of the workstation's operational
posture. It is not an independent infrastructure surface with its own identity,
execution plane, or collection scope.

Reasons to keep it inside `mac-diagnostics`:

- one workstation Source remains one workstation Source
- compare stays anchored to the same `mac:<workstation>` target
- automation-agent wrappers do not need a new token or route shape
- the cleanup signal becomes part of broader workstation posture, alongside
  firewall, FileVault, listeners, remote access, disk pressure, and Homebrew
  drift

## Constraints

- no raw file contents, secrets, session data, or cleanup report dumps inside
  the artifact
- no change to cleanup deletion behavior because of SignalForge state
- no new artifact family, collection scope kind, or execution-agent role
- no hard dependency on daily cleanup state for Mac collection success
- no assumption that every Mac Source has the daily cleanup lane installed

## Source of truth split

Keep the authority boundary sharp:

- local cleanup script: executes cleanup, owns deletion policy, writes report
  and manifest
- Mac collector: reads the latest cleanup report opportunistically and converts
  it into bounded enrichment fields
- SignalForge analyzer: interprets the enrichment, stores runs, compares drift,
  and presents operator reasoning

SignalForge should never become the direct deletion decision-maker for cleanup.

## Enrichment contract

The Mac collector should discover the newest cleanup report under the lane path
and emit a bounded set of fields.

Recommended field set:

- `daily_cleanup_report_status`
- `daily_cleanup_report_run_id`
- `daily_cleanup_report_finished_at`
- `daily_cleanup_report_age_hours`
- `daily_cleanup_initial_free_bytes`
- `daily_cleanup_final_free_bytes`
- `daily_cleanup_free_space_delta_bytes`
- `daily_cleanup_cache_paths_removed_count`
- `daily_cleanup_worktrees_removed_count`
- `daily_cleanup_active_cache_skips_count`
- `daily_cleanup_needs_review_count`
- `daily_cleanup_reclaimed_by_category_json`
- `daily_cleanup_needs_review_summary_json`
- `daily_cleanup_retained_large_stores_json`

Bound the JSON fields:

- `reclaimed_by_category_json`: full map is acceptable if still small
- `needs_review_summary_json`: summary counts plus the already-bounded
  `priority_review_candidates`
- `retained_large_stores_json`: path, size, reason only

Do not emit:

- raw `needs_review` lists
- raw manifest payloads
- arbitrary local paths outside the bounded retained-store and candidate shapes
- contents of deleted or retained files

## Collector behavior

`collect-mac-diagnostics.sh` should:

1. keep current output stable when no cleanup report exists
2. attempt to read the newest daily cleanup report from the lane
3. mark one of these states:
   - `present`
   - `missing`
   - `stale`
   - `invalid`
4. continue successfully even if cleanup enrichment is unavailable

Recommended discovery rules:

- primary lane path:
  `/Users/canepro/.codex/automations/daily-cleanup/reports/`
- prefer newest `*.json` report by mtime
- validate the chosen report before using it
- treat a malformed file as `invalid`, not as collector failure

Recommended freshness rules:

- `present`: latest report age <= 36h
- `stale`: latest report age > 36h

The exact threshold can be adjusted, but it should stay explicit and tested.

## Deterministic analyzer rules

The Mac adapter should stay deterministic-first and avoid noisy findings.

Candidate findings:

1. Cleanup report missing or invalid while root volume usage is elevated.
   Severity: medium when disk usage >= 85%, otherwise low.

2. Cleanup report stale while root volume usage is elevated.
   Severity: medium when disk usage >= 85%, otherwise low.

3. Cleanup review queue contains stale manual candidates.
   Trigger from `needs_review_summary.review_buckets.stale_candidate > 0`.
   Severity: low by default, medium if disk usage >= 85%.

4. Cleanup review queue contains prune candidates.
   Trigger from `missing_path_prune_candidate > 0`.
   Severity: low.

5. Protected retained store remains large under disk pressure.
   Trigger when retained stores exceed the current protected threshold and root
   volume usage is elevated.
   Severity: low or medium depending on pressure.

Rules that should stay noise or summary-only:

- negative free-space delta by itself
- small reclaimed totals
- expected active skips like Safari permission boundaries
- expected skips for active package caches such as `uv`

## Comparison and trend reasoning

The first slice should focus on single-run deterministic findings plus normal
compare output. Trend logic can rely on repeated Mac runs rather than packing
multi-run history into one artifact.

SignalForge compare should then naturally expose:

- repeated low-yield cleanup
- growing protected stores
- recurring review candidates
- cleanup freshness drift

## Automation model

Long-term safe behavior:

1. local daily cleanup automation runs first
2. it writes the normal report and manifest
3. a Mac diagnostic collection can happen separately, either:
   - push-first from the workstation, or
   - job-driven through a Mac Source and local execution agent
4. SignalForge ingests the enriched Mac artifact and reasons over it

Optional later step:

- the daily cleanup automation may trigger an immediate post-cleanup Mac
  diagnostic submission when a local SignalForge destination is configured

That later step must remain optional so cleanup still works when SignalForge is
down or not configured.

## Edge cases

- No cleanup lane installed on the machine: collector reports `missing`.
- Cleanup lane present but no reports yet: collector reports `missing`.
- Latest report malformed: collector reports `invalid`.
- Latest report valid but stale: collector reports `stale` and still emits the
  last known metrics.
- Cleanup report schema evolves: collector should ignore unknown fields and only
  depend on the bounded summary keys.
- Multiple reports in quick succession: newest valid report wins.
- Protected large store paths differ across machines: analyzer should key on
  size and pressure more than machine-specific path names.
- Machines without Homebrew or with partial permissions should still produce a
  valid Mac artifact.
- Mac job-driven collection and push-first collection must emit the same
  cleanup enrichment shape.

## Implementation slices

### Slice 1: contract and collector enrichment

- add cleanup-report discovery and bounded export to
  `signalforge-collectors/collect-mac-diagnostics.sh`
- document the emitted fields
- add collector validation coverage for `missing`, `invalid`, and `present`

### Slice 2: deterministic Mac analyzer support

- extend `signalforge` Mac parsing helpers for cleanup fields
- add deterministic pre-findings and noise handling
- keep current Mac findings behavior stable when cleanup fields are absent

### Slice 3: fixtures and end-to-end validation

- add enriched Mac fixture coverage
- validate `POST /api/runs` with enriched `mac-diagnostics`
- validate compare and run-detail behavior where relevant

### Slice 4: optional automation follow-through

- teach the daily cleanup automation to trigger or submit an enriched Mac run
  only when explicitly configured
- keep that integration metadata-only and failure-tolerant

### Slice 5: skill and operator guidance review

- review `/Users/canepro/.codex/skills/signalforge-ops/SKILL.md` after the
  implementation lands
- update the skill only if the stable operator model, routing guidance, or
  safety boundaries changed in a way the skill should teach by default
- leave the skill untouched if the implementation fits the current guidance

## Validation plan

- collector script tests for presence, missing report, stale report, and invalid
  report
- adapter tests for new deterministic findings
- API route tests proving enriched Mac artifacts persist normally
- one real local enriched artifact collected on this Mac
- one local SignalForge ingest smoke using that artifact
- one post-implementation check of `signalforge-ops` to confirm whether the
  skill needs a routing or guidance update

## Non-goals

- new `daily-cleanup` artifact family
- new cleanup-specific Source type
- automatic deletion decisions from SignalForge
- agent-side mutation of cleanup policy or Podman state
- importing raw cleanup report bodies into SignalForge
