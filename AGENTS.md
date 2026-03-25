# SignalForge Agent Instructions

This file is the repo-local handoff for any agent working in `signalforge`.

## Product

**SignalForge**  
Infrastructure Diagnostics

SignalForge is an operator-first evidence-to-findings diagnostics product.

Current product shape:

- ingest infrastructure evidence artifacts
- analyze them with a deterministic-first pipeline
- use one LLM call for explanation and prioritization
- persist artifacts and runs
- present results in dashboard, run-detail, compare, and CLI flows

This is not:

- a chatbot
- a remediation engine in the current product scope
- a collector/orchestrator
- a generic observability platform

## Repo Boundary

SignalForge lives in its own repo:

- product repo: this repository (your `signalforge` checkout)
- collector/source repo: [Canepro/signalforge-collectors](https://github.com/Canepro/signalforge-collectors)
- execution-plane agent: [Canepro/signalforge-agent](https://github.com/Canepro/signalforge-agent) — Bun + TypeScript; heartbeat, poll, claim, run collectors, upload artifacts
- reference architecture only: [Canepro/pipelinehealer](https://github.com/Canepro/pipelinehealer)

`signalforge-collectors` produces artifacts. SignalForge consumes them. A **reference push path** lives in that repo as `submit-to-signalforge.sh` (runs `first-audit.sh`, then `POST /api/runs` with ingestion metadata); see that repo’s README. For **job-driven** collection, the **`signalforge-agent`** repo heartbeats, polls `GET /api/agent/jobs/next`, claims jobs, runs `first-audit.sh` from `signalforge-collectors`, and uploads via `POST /api/collection-jobs/{id}/artifact`. See that repo’s README for env config and `once` / `run` modes.

## Current Status

**Canonical roadmap:** [`plans/roadmap.md`](plans/roadmap.md).  
**Current snapshot:** [`plans/current-plan.md`](plans/current-plan.md).

Completed through **Phase 6e** (agent repo + Sources UI polish; see `plans/current-plan.md`): analyzer, API/DB, UI, reanalyze, compare (UI + JSON API), CLI submit + **read** helpers, published API contract, **Sources** + **collection jobs** (`/sources`, operator APIs) behind **`SIGNALFORGE_ADMIN_TOKEN`** (Bearer for HTTP; `/sources/login` sets an httpOnly session cookie — not in the client bundle), agent registration API (one token per source), **agent execution routes** with **strict `instance_id`** on start/fail/artifact and on heartbeat when reporting `active_job_id`, and **strict jobs/next** (must heartbeat first with a **non-empty** capability list that includes the job’s `collect:<artifact_type>` via agent∩source caps). Lease reaper: claimed→queued, running→expired per Phase 6b. **Collection job `submitted`** means the artifact was accepted; **`result_analysis_status`** (and artifact-upload **`run_status`**) reflects whether the linked run succeeded analysis (`complete` vs `error`, etc.). Heartbeat **200** includes **`active_job_lease`** so agents see whether the lease was extended. **`signalforge-agent`** repo (Bun + TypeScript) implements the first thin external agent; validated E2E. Sources UI uses unified sidebar+topbar layout matching dashboard, with health dots, job status badges, inline settings (enable/disable, rename), agent enrollment info, action feedback, and cancel confirmation.

**Artifacts:** `linux-audit-log` only.

**Providers:** OpenAI direct; Azure OpenAI Responses with **legacy** (requires `AZURE_OPENAI_API_VERSION`) or **`/openai/v1` base URL** (omit API version — Azure rejects `api-version` on v1). Deterministic fallback if unavailable or misconfigured. See `README.md` env table.

**Stack:** Next.js (App Router), Bun, TypeScript, React, Tailwind CSS, sql.js (SQLite local), Postgres/Neon (production), Vitest, GitHub Actions CI.

**Deployment:** Vercel with Neon Postgres. The live site uses `DATABASE_DRIVER=postgres`.

**CI:** GitHub Actions (`.github/workflows/ci.yml`): typecheck, test, build on every push to `main` and on PRs; a separate Postgres parity job starts `postgres:16-alpine`, applies migrations, and runs `bun run test:parity`. Postgres schema changes follow the checked-in migration policy: [`docs/postgres-migrations.md`](docs/postgres-migrations.md).

## Current Priorities

If starting fresh in this repo, work from the current plan first:

- [`docs/getting-started.md`](docs/getting-started.md)
- [`plans/roadmap.md`](plans/roadmap.md)
- [`plans/current-plan.md`](plans/current-plan.md)
- [`docs/README.md`](docs/README.md)

Historical context:

- [`plans/mvp.md`](plans/mvp.md)
- [`plans/phase-2-ui.md`](plans/phase-2-ui.md)

Those older plan files are useful context, but they are no longer the source of truth for current status.

**External agent (implemented):** `signalforge-agent` repo (Bun + TypeScript) implements the thin execution-plane agent from Phase 6b. Validated end-to-end: source → queued job → agent claim → first-audit.sh → artifact upload → submitted job + linked run. Lease-loss is fatal (agent aborts + POSTs fail); artifact selection requires a freshly produced log (snapshot before/after). Reference: [`plans/phase-6b-source-job-api-contract.md`](plans/phase-6b-source-job-api-contract.md).

## Documentation Hierarchy

Use these docs in this order unless the task is very narrow:

1. `README.md` for product overview
2. `docs/getting-started.md` for first-run setup and beginner usage
3. `docs/README.md` for the docs map
4. `plans/roadmap.md` for long-term direction
5. `plans/current-plan.md` for current shipped state
6. `docs/api-contract.md` and `docs/external-submit.md` for integrations

## Architecture

Three planes:

1. Collection plane
- external collectors produce artifacts
- SignalForge does not collect live evidence itself today

2. Analysis plane
- adapter selection
- deterministic parsing and normalization
- environment detection
- noise classification
- deterministic pre-findings
- incomplete detection
- one LLM explanation/prioritization pass
- persistence

3. Consumer plane
- dashboard (upload, run list, KPIs, **Collect externally** / sidebar **How to collect** — copyable CLI + reference-collector commands; no in-app collection)
- run detail (findings, metadata, top actions)
- reanalyze and compare flows
- API + CLI submit helper (`analyze.sh` prints compare + read URLs after submit)
- **Sources** UI: unified sidebar layout, source list with health, detail with property grid, collect job form, agent enrollment, job timeline with status badges, inline source settings
- external agent: `signalforge-agent` (separate repo)

Core directories:

- `src/lib/adapter/linux-audit-log/`
- `src/lib/analyzer/`
- `src/lib/compare/`
- `src/lib/storage/`
- `src/lib/db/`
- `src/app/`
- `src/components/`
- `tests/`

## Working Rules

- Keep deterministic analysis as the source of truth.
- Do not let the model invent findings or override deterministic severity/noise classes.
- Keep the backend channel-agnostic.
- Prefer targeted rule improvements over broad abstraction.
- Preserve evidence grounding for every finding.
- Keep UI operator-first, table-first, and light-theme by default.

## Codex Skills Available

This environment usually provides a Codex skill catalog at runtime. Agents should still verify what is available in the current session, but the following skills are known to be available and relevant to SignalForge work.

### Most Relevant Skills For This Repo

- `tdd`
- `frontend-review`
- `responsive-design`
- `webapp-testing`
- `react-performance-review`
- `frontend-uncodixfy`
- `design-an-interface`
- `design-system-maintenance`
- `improve-codebase-architecture`
- `request-refactor-plan`
- `write-a-prd`
- `prd-to-plan`
- `prd-to-issues`
- `grill-me`
- `setup-pre-commit`
- `openai-docs`

### Adjacent Platform / Ops Skills

- `observability-architecture`
- `slo-sli-design`
- `kubernetes-platform-architecture`
- `gitops-workflow`
- `ci-pipeline-triage`
- `gh-fix-ci`
- `gh-address-comments`
- `playwright`

### Runtime / Infra Investigation Skills

- `k8s-sre-triage`
- `gitops-reconcile`
- `jenkins-sre`
- `prometheus-grafana-triage`
- `sentry`

### Notes For Agents

- Use the skill if the task clearly matches it or the user explicitly names it.
- For OpenAI / Azure Responses API changes, use `openai-docs`.
- For UI critique or layout cleanup, use `frontend-review` and `responsive-design`.
- For behavior changes, prefer `tdd`.
- For architectural cleanup or reshaping module boundaries, use `improve-codebase-architecture` or `design-an-interface`.
- Treat skill availability as session-dependent. Re-check the runtime skill list if a named skill is missing.

## Non-Goals

Do not expand into these without an explicit plan change:

- collectors inside SignalForge
- scheduling
- auth
- chat
- generalized policy engine
- remediation in the current product scope
- multi-tenant/fleet management
- broad platform abstraction

## UI Direction

Locked product choices:

- product name: `SignalForge`
- subtitle: `Infrastructure Diagnostics`
- operator-first
- light theme by default
- calm gray-blue palette
- severity colors only for severity
- no chatbot-first layout
- no marketing-site patterns

Approved visual references:

- home/dashboard reference: `/mnt/c/Users/i/Downloads/stitch.zip`
- run-detail reference: `/mnt/c/Users/i/Downloads/stitch (1).zip`

Use these as layout/style references, not pixel-perfect cloning targets.

## Data / API

Key routes:

- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/[id]` (includes `links.compare_api` / `links.compare_ui`)
- `GET /api/runs/[id]/report`
- `GET /api/runs/[id]/compare` — JSON drift (same logic as compare UI; optional `?against=<runId>`)
- `POST /api/runs/[id]/reanalyze`
- page: `/runs/[id]/compare`

Current important behavior:

- artifacts are immutable
- runs are separate from artifacts
- reanalysis creates a new run
- compare is deterministic and target-aware
- **Compare baseline:** without `?against=`, baseline is the **latest older same-target** run, not necessarily `parent_run_id`; use `?against=` (or run-detail **vs parent**) when callers need an explicit lineage baseline

## Commands

Install:

```bash
bun install
```

Dev server:

```bash
bun run dev
```

Typecheck:

```bash
bun run typecheck
```

Tests:

```bash
bun test
```

Storage parity tests (SQLite always; Postgres when `DATABASE_URL_TEST` is set):

```bash
bun run test:parity
```

Postgres migrations:

```bash
bun run db:migrate:postgres
```

Build:

```bash
bun run build
```

Direct analyzer:

```bash
bun run analyze tests/fixtures/wsl-mar2026-full.log
```

CLI submit helper (prints run, compare, and read commands on success):

```bash
./scripts/analyze.sh tests/fixtures/wsl-mar2026-full.log
```

Read helpers (GET run detail, report, compare JSON):

```bash
./scripts/signalforge-read.sh run <run-id>
./scripts/signalforge-read.sh report <run-id>
```

See **`scripts/signalforge-read.sh --help`** for `compare` and `--url`.

Beginner-friendly setup and first-run guide:

- `docs/getting-started.md`

External HTTP contract for `POST /api/runs` (multipart vs JSON, optional metadata): **`docs/external-submit.md`**.

Full route list, status codes, and response types: **`docs/api-contract.md`** (JSON schemas under **`docs/schemas/`**).

## Test Anchors

Mandatory fixtures:

- `tests/fixtures/sample-prod-server.log`
- `tests/fixtures/wsl-nov2025-full.log`
- `tests/fixtures/wsl-nov2025-truncated.log`
- `tests/fixtures/wsl-mar2026-full.log`

When changing findings logic, verify against these first.

## Good Next Work

See **`plans/roadmap.md`** for the long-lived plan and **`plans/current-plan.md`** for the maintained near-term list. For **Phase 5** (collectors / fresh evidence), the design draft is **`plans/phase-5-collector-architecture.md`** — implementation stays deferred until that contract is agreed.

## Handoff Expectation

Any new agent should:

1. read `README.md`
2. read `plans/roadmap.md`
3. read `plans/current-plan.md`
4. skim this file
5. inspect the relevant code paths
6. preserve the deterministic-first architecture
