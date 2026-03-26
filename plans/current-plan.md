# SignalForge — current plan (operational snapshot)

This file tracks **implemented** work and **recommended next steps**.

For the canonical long-lived roadmap, see [`roadmap.md`](./roadmap.md).
For historical narrative, see `plans/mvp.md` and `plans/phase-2-ui.md` (marked historical at the top).

Current branch note: `main` still reflects the pre-Phase-8 hardening handoff at `431ec32`. The `codex/phase-8-implementation` branch has progressed further and the Phase 8 rows below describe the current branch reality rather than released `main`.

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
| 8a | Multi-artifact compare uplift: shared `evidence_delta`, family-aware metrics, target-aware compare support for stable evidence drift | Done on branch |
| 8b | `container-diagnostics`: adapter, ingestion, compare, fixtures/golden tests, container-aware fallback wording and metrics | Done on branch |
| 8c | `kubernetes-bundle` push path: locked `kubernetes-bundle.v1` manifest, adapter, ingestion, compare, fixtures/golden tests, scope-aware target identity | Done on branch |
| 8d | Kubernetes findings-quality expansion: exposure, RBAC, secret, hardening, host-escape, compare normalization, deterministic platform noise, and exposure-plus-identity joins | Done on branch |

## Product snapshot

- **Artifacts:** `linux-audit-log` (`first-audit.sh`-style host audit output), `container-diagnostics` (text-based container diagnostics for a single container or workload), and `kubernetes-bundle` (UTF-8 JSON manifest for cluster- or namespace-scoped Kubernetes evidence).
- **LLM:** OpenAI direct or Azure OpenAI **Responses** API; deterministic fallback if misconfigured or unavailable.
- **Workflows:** artifact **upload** (UI/API), **run detail**, **reanalyze** (same artifact, new run), **compare** (deterministic finding drift plus `evidence_delta`), **CLI** upload helper, **Sources** (`/sources`) for registered targets and **queued** collection jobs, **signalforge-agent** for external job-driven collection (heartbeat + poll + claim + collect + upload).
- **Persistence:** `sqlite` remains the default local backend; `postgres` is now available behind `DATABASE_DRIVER=postgres` with checked-in SQL migrations. The live Vercel deployment uses Neon Postgres.
- **Deployment workflow:** Vercel preview deployments are available for branches and PRs, so live review does not need to wait for a push or merge to remote `main`.
- **CI:** GitHub Actions runs typecheck, test, build, and a Postgres parity job on every push to `main` and on PRs. Postgres schema changes follow the checked-in migration policy (`docs/postgres-migrations.md`).
- **Stack:** Next.js (App Router), Bun, TypeScript, React, Tailwind CSS, sql.js/SQLite (local), Postgres/Neon (production), Vitest, Vercel.
- **Beginner docs:** `README.md`, `docs/getting-started.md`, and `docs/README.md` now provide the preferred onboarding path before deeper plan or API docs.

## Phase 8 branch snapshot

- `container-diagnostics` is a shipped artifact family in this checkout with credible first-slice findings around exposure, privilege, mounts, secrets, identity, and runtime hardening.
- `kubernetes-bundle` is a shipped artifact family in this checkout using the text-carried `kubernetes-bundle.v1` JSON manifest shape, not raw archive ingestion.
- Kubernetes analysis on this branch currently covers public Service exposure, namespace isolation gaps, RBAC over-breadth, workload-to-identity joins, exposed-workload-to-identity joins, token/Secret usage, workload hardening, host-escape style settings, probes, and resource governance.
- The strongest remaining Phase 8 architectural risk is unchanged: the current execution model is still effectively one registration per source, which may be too narrow for future Kubernetes or mixed-scope execution forms.

## Known limitations

- Multi-artifact support is no longer just scaffolding, but Phase 8 quality is still uneven: container coverage is solid first-slice quality, while Kubernetes still has more depth on findings than on noise suppression and finding-key normalization.
- Recommendations and summaries are bounded by captured evidence and deterministic rules.
- WSL/systemd noise suppression will need ongoing tuning as logs vary.
- The current source and agent model is still effectively one registration per source, which may become limiting for Kubernetes or future multi-scope execution.

## Recommended next work (high level)

- Use the product with more real submissions and note friction before adding broad new surface area.
- Further findings tuning on real artifacts (SSH, auth, logs) as new fixtures land.
- Compare/export hardening (small, targeted).
- Finish the Phase 8 merge cleanup before new Phase 9 code spreads further. The merge gate is now:
  - README, docs index, roadmap, and current-plan all reflect three shipped artifact families in this branch
  - control-plane honesty is explicit: Linux is the cleanest end-to-end path; container and Kubernetes have push-first parity and host-agent limits
  - branch-local validation for Phase 8 and the current `collection_scope` contract stays green
- Phase 8 next-step prep is in place in [phase-8-containers-k8s.md](/home/vincent/src/signalforge/plans/phase-8-containers-k8s.md). Current branch work has completed Phase 0, the container slices, the Kubernetes push path, and the first substantial Kubernetes findings-quality pass. The artifact-envelope gate remains locked to the text-carried `kubernetes-bundle.v1` manifest.
- For Kubernetes specifically, prefer a higher quality bar over the smallest possible demo: use official upstream guidance, relevant local skills, realistic fixtures, and read-only live-cluster inspection when that materially improves rule credibility. Use richer platform examples when helpful, but keep the actual detections and wording anchored in plain Kubernetes primitives so the product still fits operators with simpler clusters.
- Best next implementation move after the Phase 8 merge gate is closed: execute the documented Phase 9 cross-repo slice for job-scoped collection parameters so container and Kubernetes jobs stop depending on hidden host-local environment. Source of truth: [`phase-9-job-scoped-collection-parameters.md`](./phase-9-job-scoped-collection-parameters.md).
- Phase 9 repo-local progress is now ahead of the original API-only slice:
  - Sources create/edit flows can store typed `default_collection_scope`
  - source detail and dashboard request flows can send typed per-job `collection_scope` overrides
  - operator UI now shows stored source default scope and resolved job scope
  - the remaining Phase 9 work is cross-repo: `signalforge-agent` and `signalforge-collectors` still need to consume the same typed scope contract end to end
- Preferred deployment stance for `signalforge-agent`: long-running hardened service near the execution surface. Today that means a host `systemd` service is the first-class path. Container and Kubernetes-native packaging remain follow-on work after the scoped job contract and trust boundaries are explicit.
- Backend parity is in CI. Storage parity tests exercise both SQLite and Postgres. Upgrade-path migration coverage activates once `002_*` exists, and Postgres schema changes should follow the checked-in migration policy: [`../docs/postgres-migrations.md`](../docs/postgres-migrations.md). Plan: [`phase-7-storage-abstraction.md`](phase-7-storage-abstraction.md).
- **Phase 6 agent delivered:** `signalforge-agent` repo implements the thin external agent from Phase 6b; validated E2E. Scheduling, notifications, token rotation, multi-source agents remain out of scope. Contract: [`phase-6b-source-job-api-contract.md`](phase-6b-source-job-api-contract.md). Architecture: [`phase-6-source-job-agent-architecture.md`](phase-6-source-job-agent-architecture.md). Boundary: [`phase-5-collector-architecture.md`](phase-5-collector-architecture.md); roadmap: [`roadmap.md`](./roadmap.md).
- Harden agent in real use: exponential backoff on network errors, Playwright/browser smoke test for Sources UI, hardened `systemd` unit and credential-loading path for `signalforge-agent run`, and explicit non-laptop deployment guidance for Kubernetes-capable environments.
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
