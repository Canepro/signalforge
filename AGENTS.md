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

Completed on `main` through **Phase 6e** (agent repo + Sources UI polish; see `plans/current-plan.md`): analyzer, API/DB, UI, reanalyze, compare (UI + JSON API), CLI submit + **read** helpers, published API contract, **Sources** + **collection jobs** (`/sources`, operator APIs) behind **`SIGNALFORGE_ADMIN_TOKEN`** (Bearer for HTTP; `/sources/login` sets an httpOnly session cookie — not in the client bundle), agent registration API (one token per source), **agent execution routes** with **strict `instance_id`** on start/fail/artifact and on heartbeat when reporting `active_job_id`, and **strict jobs/next** (must heartbeat first with a **non-empty** capability list that includes the job’s `collect:<artifact_type>` via agent∩source caps). Lease reaper: claimed→queued, running→expired per Phase 6b. **Collection job `submitted`** means the artifact was accepted; **`result_analysis_status`** (and artifact-upload **`run_status`**) reflects whether the linked run succeeded analysis (`complete` vs `error`, etc.). Heartbeat **200** includes **`active_job_lease`** so agents see whether the lease was extended. **`signalforge-agent`** repo (Bun + TypeScript) implements the first thin external agent; validated E2E. Sources UI uses unified sidebar+topbar layout matching dashboard, with health dots, job status badges, inline settings (enable/disable, rename), agent enrollment info, action feedback, and cancel confirmation.

Current branch work has moved into **Phase 8**:

- `container-diagnostics` and `kubernetes-bundle` are both implemented artifact families in this checkout
- compare now includes deterministic `evidence_delta` output for stable evidence and metadata drift
- container analysis now covers runtime isolation signals such as privileged mode, host namespaces, writable mounts, writable root filesystem, root execution, capability adds, socket mounts, and secret mounts
- Kubernetes analysis now covers first-slice exposure, RBAC escalation, token automount, default service-account use, writable root filesystems, secret-backed env injection, `envFrom` Secret imports, probes, and resource-governance signals
- Kubernetes support in this branch still uses the locked `kubernetes-bundle.v1` UTF-8 JSON manifest shape, not raw support-bundle archive ingestion

**Artifacts:** `linux-audit-log`, `container-diagnostics`, `kubernetes-bundle`.

**Providers:** OpenAI direct; Azure OpenAI Responses with **legacy** (requires `AZURE_OPENAI_API_VERSION`) or **`/openai/v1` base URL** (omit API version — Azure rejects `api-version` on v1). Deterministic fallback if unavailable or misconfigured. See `README.md` env table.

**Stack:** Next.js (App Router), Bun, TypeScript, React, Tailwind CSS, sql.js (SQLite local), Postgres/Neon (production), Vitest, GitHub Actions CI.

**Deployment:** The repo now documents three deployment surfaces that agents should keep separate. Local development defaults to SQLite. Vercel remains the preview/review surface for branches and PRs. The app also has a committed containerized Azure Container Apps path (`Dockerfile`, `infra/aca/main.bicep`) that keeps `DATABASE_DRIVER=postgres` with Neon Postgres. The current primary app-hosting path is the ACA app documented in repo history and infra; some resource names still use `staging`, but treat those as legacy identifiers rather than the canonical environment vocabulary.

**CI:** GitHub Actions (`.github/workflows/ci.yml`): typecheck, test, build on every push to `main` and on PRs; a separate Postgres parity job starts `postgres:16-alpine`, applies migrations, and runs `bun run test:parity`. Postgres schema changes follow the checked-in migration policy: [`docs/postgres-migrations.md`](docs/postgres-migrations.md).

**Local Postgres validation:** prefer [`scripts/run-postgres-parity-local.sh`](scripts/run-postgres-parity-local.sh) for local Postgres parity work. It mirrors the CI flow by resolving a local Postgres URL, applying migrations, and then running the parity suite with one-shot env vars.

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

For this branch specifically, prioritize current checkout reality over older phase labels. The working source of truth is still `plans/current-plan.md`, but this branch intentionally contains newer Phase 8 slices than `main`.

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
- Before any meaningful analysis, coding, or review, check the current session skill catalog for a relevant local skill. If one exists, open its `SKILL.md` first, say which skill is being used and why, and do not start implementation until that check is complete. If no relevant skill exists, say that explicitly before continuing.
- Keep UI operator-first, table-first, and light-theme by default.
- Use the local `naming-quality` skill whenever naming or renaming files, fixtures, modules, exported identifiers, routes, API fields, or user-facing labels.
- Treat naming as part of product quality. Prefer scenario-based, open-source-safe names over names tied to the author's machine, provider, runtime, or temporary environment unless that provenance is itself the behavior under test.
- Do not optimize Kubernetes or container work for the weakest demo that happens to pass tests. Prefer slices that feel credible to a real platform engineer.
- For Kubernetes, container, and platform-security work, prefer official upstream guidance and cloud-provider best practices over ad hoc heuristics when choosing rules, priorities, and wording.
- Use relevant local skills proactively when the task matches them, especially `kubernetes-platform-architecture`, `k8s-sre-triage`, `gitops-workflow`, `observability-architecture`, `grill-me`, and `tdd`.
- When realistic validation or fixture quality would materially improve the result, use the available local runtime tools and environments instead of staying purely synthetic. This machine may provide `kubectl`, `podman`, Docker-compatible commands, local clusters, and cloud-cluster access.
- Use richer platform examples when they help widen coverage, but keep the product model rooted in plain Kubernetes primitives. Rules, docs, labels, and fixtures should still make sense to operators who do not run Argo CD, Grafana, external-secrets, or any other optional platform layer.
- Prefer detections that map back to broadly available Kubernetes surfaces such as workload specs, Services, RBAC, probes, volumes, securityContext, and NetworkPolicy. Platform-specific examples are evidence sources, not the product boundary.
- Be careful with live infrastructure: inspect first, prefer read-only commands by default, avoid changing cluster state unless explicitly requested, and report clearly which environment was used.
- For deployment and environment docs, keep three states separate: local development, Vercel preview/review, and the primary ACA app path. Treat legacy `staging` names as resource identifiers, not the canonical environment taxonomy, and prefer current role-based wording such as `primary ACA app` when describing the live app-hosting path.
- After non-trivial changes, run targeted validation by default.
- In `--yolo` or other high-autonomy workflows, do not skip relevant verification unless the user explicitly says to.
- Prefer the smallest validation that meaningfully covers the change.
- After validation, report exactly what ran, what passed, what failed, and any remaining risk.
- For local Postgres parity, prefer `bash scripts/run-postgres-parity-local.sh` over ad hoc exported connection strings unless the task specifically requires a different database target.

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
- `naming-quality` when available

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
- For Kubernetes and platform work, do not stop at toy examples when better evidence is available. Use official documentation, realistic fixtures, and live read-only inspection when that materially improves rule quality or operator trust.
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

Local Postgres parity helper (detects local Podman Postgres such as `signalforge-pg`, applies migrations, then runs parity):

```bash
bash scripts/run-postgres-parity-local.sh
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
- `tests/fixtures/container-database-service.txt`
- `tests/fixtures/kubernetes-payments-bundle.json`
- `tests/fixtures/kubernetes-public-ingress-namespace.json`

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
