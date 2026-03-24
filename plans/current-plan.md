# SignalForge — current plan (operational snapshot)

This file tracks **implemented** work and **recommended next steps**.

For the canonical long-lived roadmap, see [`roadmap.md`](./roadmap.md).
For historical narrative, see `plans/mvp.md` and `plans/phase-2-ui.md` (marked historical at the top).

## Implemented phases

| Phase | Scope | Status |
|-------|--------|--------|
| 1a | Analyzer core (`linux-audit-log` adapter, deterministic pipeline, LLM explanation, fixtures) | Done |
| 1b | SQLite persistence (`sql.js`), `/api/runs` JSON + multipart, route tests | Done |
| 2 | Dashboard UI: home, run detail, upload, core components | Done |
| 3 | Reanalyze (`POST /api/runs/[id]/reanalyze`), compare (`/runs/[id]/compare`), CLI helper `scripts/analyze.sh` | Done |
| 4 | Findings-quality passes (listener wording, observability labeling, WSL noise, compare stability, fallback quality) | Done |
| 4b | Deeper listener/service identification from `ss` / `users:(...)`, exposure wording, drift normalization for listener titles | Done |
| 4c | Repo docs handoff (`README` / `AGENTS` / this file); deterministic fallback summary (incomplete audits, network blurbs), category tie-break for actions; LLM prompt tuning for incomplete audits and prioritization | Done |
| 5a | Ingestion metadata contract: optional `target_identifier`, `source_label`, `collector_type`, `collector_version`, `collected_at` on runs; `POST /api/runs` JSON + multipart; reanalyze copies metadata | Done |
| 5b | Target identity alignment: baseline/compare prefer `target_identifier`, then normalized hostname, then same-artifact fallback; shared helpers | Done |
| 5c | External submit contract doc (`docs/external-submit.md`); `scripts/analyze.sh` flags + env for Phase 5a metadata | Done |
| 5d | Programmatic compare: `GET /api/runs/[id]/compare` (optional `against`); shared `buildCompareDriftPayload`; `links` on run detail | Done |
| 5e | CLI read helpers: `scripts/signalforge-read.sh` (`run` \| `report` \| `compare`) | Done |
| 5f | Published API contract: `docs/api-contract.md`, `docs/schemas/`, `src/types/api-contract.ts`, `toRunDetailJson` | Done |
| 6c | Source + `CollectionJob` persistence; operator APIs with `SIGNALFORGE_ADMIN_TOKEN`; `/sources` UI (login cookie, jobs, enroll agent); lease reaper; tests | Done |
| 6d | Agent-facing HTTP: heartbeat, jobs/next, claim/start/fail/artifact; source-bound Bearer; domain events; tests | Done |
| 6d-hardening | Strict `instance_id` on heartbeat (when `active_job_id` set), start, fail, artifact; strict jobs/next gating (heartbeat + non-empty caps + collect match); explicit `gate` / error codes | Done |
| API errors / job honesty | Generic **500** JSON on touched routes; heartbeat **200** reports lease extension truth; submitted jobs store **`result_analysis_status`** (run `complete` \| `error`, …) | Done |
| 7a | Storage abstraction extracted across runs, sources, jobs, and agents; routes/pages/actions use `src/lib/storage/*` instead of raw `getDb()` | Done |
| 7b | Initial Postgres backend adapter, backend selection via `DATABASE_DRIVER`, checked-in SQL migrations, migration script with `schema_migrations` tracking | Done |
| 6e-agent | `signalforge-agent` repo (Bun + TypeScript): heartbeat, poll, claim, run `first-audit.sh`, upload artifact, fail with explicit codes. Fatal lease-loss (abort + POST fail). Snapshot-based artifact selection (no stale logs). Validated E2E against live SignalForge. | Done |
| Sources UI polish | Unified sidebar+topbar layout (matches dashboard), health indicators, job status badges, property grids, source settings (rename/enable/version), agent enrollment info, action feedback (loading/saved states), cancel confirmation, staggered animations, gradient accents | Done |
| CI + migration discipline | GitHub Actions workflow (`ci.yml`): typecheck, test, build + Postgres parity job (fresh `postgres:16-alpine`, apply migrations, `test:parity`). Checked-in migration policy (`docs/postgres-migrations.md`): append-only files, checksum enforcement, no-down stance, release discipline. Upgrade-path migration test scaffold (activates once `002_*` exists). | Done |

## Product snapshot

- **Artifacts:** `linux-audit-log` only (`first-audit.sh`-style host audit output).
- **LLM:** OpenAI direct or Azure OpenAI **Responses** API; deterministic fallback if misconfigured or unavailable.
- **Workflows:** artifact **upload** (UI/API), **run detail**, **reanalyze** (same artifact, new run), **compare** (deterministic finding drift), **CLI** upload helper, **Sources** (`/sources`) for registered targets and **queued** collection jobs, **signalforge-agent** for external job-driven collection (heartbeat + poll + claim + collect + upload).
- **Persistence:** `sqlite` remains the default local backend; `postgres` is now available behind `DATABASE_DRIVER=postgres` with checked-in SQL migrations. The live Vercel deployment uses Neon Postgres.
- **CI:** GitHub Actions runs typecheck, test, build, and a Postgres parity job on every push to `main` and on PRs. Postgres schema changes follow the checked-in migration policy (`docs/postgres-migrations.md`).
- **Stack:** Next.js (App Router), Bun, TypeScript, React, Tailwind CSS, sql.js/SQLite (local), Postgres/Neon (production), Vitest, Vercel.
- **Beginner docs:** `README.md`, `docs/getting-started.md`, and `docs/README.md` now provide the preferred onboarding path before deeper plan or API docs.

## Known limitations

- Single artifact family; quality is best where evidence is explicit (disk, packages, SSH, listeners, incomplete sections).
- Recommendations and summaries are bounded by captured evidence and deterministic rules.
- WSL/systemd noise suppression will need ongoing tuning as logs vary.

## Recommended next work (high level)

- Use the product with more real submissions and note friction before adding broad new surface area.
- Further findings tuning on real artifacts (SSH, auth, logs) as new fixtures land.
- Compare/export hardening (small, targeted).
- Backend parity is in CI. Storage parity tests exercise both SQLite and Postgres. Upgrade-path migration coverage activates once `002_*` exists, and Postgres schema changes should follow the checked-in migration policy: [`../docs/postgres-migrations.md`](../docs/postgres-migrations.md). Plan: [`phase-7-storage-abstraction.md`](phase-7-storage-abstraction.md).
- **Phase 6 agent delivered:** `signalforge-agent` repo implements the thin external agent from Phase 6b; validated E2E. Scheduling, notifications, token rotation, multi-source agents remain out of scope. Contract: [`phase-6b-source-job-api-contract.md`](phase-6b-source-job-api-contract.md). Architecture: [`phase-6-source-job-agent-architecture.md`](phase-6-source-job-agent-architecture.md). Boundary: [`phase-5-collector-architecture.md`](phase-5-collector-architecture.md); roadmap: [`roadmap.md`](./roadmap.md).
- Harden agent in real use: exponential backoff on network errors, Playwright/browser smoke test for Sources UI, systemd unit file for `signalforge-agent run`.
- Future notifications should attach to domain events now that the source/job/agent model is stable.
- Keep docs beginner-friendly and current as the product surface grows. `README.md` should stay orientation-first; detailed contracts belong under `docs/`.

## Where to look in code

| Area | Path |
|------|------|
| Adapter | `src/lib/adapter/linux-audit-log/` |
| Analyzer + fallback | `src/lib/analyzer/` |
| Compare drift keys | `src/lib/compare/findings-diff.ts` |
| Compare (UI + JSON API) | `src/lib/compare/build-compare.ts`, `src/app/api/runs/[id]/compare/route.ts`, `/runs/[id]/compare` |
| API / UI | `src/app/`, `src/lib/db/` |
| External submit (contract) | `docs/external-submit.md`, `src/lib/ingestion/meta.ts` |
| CLI read (curl wrappers) | `scripts/signalforge-read.sh` |
| Published API (routes + schemas) | `docs/api-contract.md`, `docs/schemas/`, `src/types/api-contract.ts` |
| Reference push collector (outside repo) | `signalforge-collectors` — `submit-to-signalforge.sh` (see that README) |
| Thin agent (outside repo) | `signalforge-agent` — poll/claim/run collectors + `…/artifact` (see that README) |
| Phase 6a design | `plans/phase-6-source-job-agent-architecture.md` — Source, `CollectionJob`, thin agent protocol |
| Phase 6b contract | `plans/phase-6b-source-job-api-contract.md` — normative schema + operator/agent HTTP |
| Phase 6c–6d implemented | `src/lib/db/source-job-repository.ts`, `src/app/api/sources/`, `src/app/api/collection-jobs/*`, `src/app/api/agent/*` (registrations, heartbeat, jobs/next), `/sources` UI, `middleware.ts`, `src/lib/api/admin-auth.ts`, `src/lib/api/agent-auth.ts` |
