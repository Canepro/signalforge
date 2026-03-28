# SignalForge

**Infrastructure Diagnostics** for evidence artifacts.

SignalForge ingests infrastructure evidence, turns it into findings, stores runs, and helps operators answer three practical questions:

- what did this artifact show?
- what changed since the last run?
- what should I do now?

Today, the current branch supports three artifact families:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

That currently means Linux and WSL audit logs in the `signalforge-collectors` style, plus text-based container diagnostic artifacts for a single container or workload, and UTF-8 JSON Kubernetes evidence bundles.

## What SignalForge Is

SignalForge is an **analysis platform**, not a collection engine.

It does these things well today:

- ingests evidence artifacts
- extracts deterministic findings
- uses one LLM call for explanation and prioritization
- stores immutable artifacts and per-analysis runs
- exposes results through UI, APIs, and CLI helpers

It does **not** currently:

- SSH into servers
- run `kubectl` against clusters
- execute collectors inside the app
- perform remediation from the current product

Collection stays external by design. Remediation remains deferred, and any future remediation path would need to be a separate higher-trust capability with explicit approvals and auditability.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router)
- **Runtime:** [Bun](https://bun.sh/)
- **Language:** TypeScript
- **UI:** React, Tailwind CSS
- **Local DB:** SQLite via [sql.js](https://github.com/sql-js/sql.js)
- **Production DB:** Postgres ([Neon](https://neon.tech/) in the current deployment)
- **Testing:** [Vitest](https://vitest.dev/)
- **Deployment:** [Vercel](https://vercel.com/)
- **CI:** GitHub Actions (typecheck, test, build, Postgres parity)

## Live Deployment

SignalForge is deployed on Vercel with a Neon Postgres backend.

The live site uses:

- `DATABASE_DRIVER=postgres`
- Neon-hosted Postgres: set `DATABASE_URL` to the connection string from Neon (direct or pooled hostname). The app uses the [`pg`](https://node-postgres.com/) driver with a connection pool (`src/lib/storage/postgres.ts`); there is no Neon-specific JavaScript driver in this repo.
- Vercel serverless functions for all API routes
- Vercel preview deployments for branches and pull requests, so feature work can be reviewed live before anything is pushed or merged to remote `main`

Local development defaults to SQLite. The production deployment uses Postgres exclusively.

## Start Here

If you are new to the repo:

1. [`docs/getting-started.md`](docs/getting-started.md)  
   Beginner-friendly setup and first successful run.
2. [`docs/README.md`](docs/README.md)  
   Documentation map and reading paths.
3. [`AGENTS.md`](AGENTS.md)  
   Repo-local working rules and agent handoff notes.
4. [`plans/roadmap.md`](plans/roadmap.md)  
   Canonical long-lived roadmap.
5. [`plans/current-plan.md`](plans/current-plan.md)  
   Current shipped state and near-term priorities.

If you are integrating with SignalForge:

- [`docs/api-contract.md`](docs/api-contract.md)
- [`docs/external-submit.md`](docs/external-submit.md)
- [`docs/schemas/README.md`](docs/schemas/README.md)

If you are operating Sources, agents, or collection jobs:

- [`docs/operators/README.md`](docs/operators/README.md)
- [`docs/agent-deployment.md`](docs/agent-deployment.md)

## 5-Minute First Run

Install dependencies:

```bash
bun install
```

Create local environment config:

```bash
cp .env.example .env.local
```

Start the app:

```bash
bun run dev
```

Submit a fixture:

```bash
./scripts/analyze.sh tests/fixtures/sample-prod-server.log
```

Read the run back:

```bash
./scripts/signalforge-read.sh run <run-id>
./scripts/signalforge-read.sh report <run-id>
./scripts/signalforge-read.sh compare <run-id>
```

For the fuller step-by-step version, use [`docs/getting-started.md`](docs/getting-started.md).

## How People Use SignalForge Today

- **Upload and review**: submit an artifact, inspect run detail, reanalyze if needed, and compare runs.
- **API and CLI consumption**: push evidence to `POST /api/runs` or use the helper scripts for submit and read flows.
- **Operator-managed collection**: register Sources, queue collection jobs, and run `signalforge-agent` near the target while collectors stay external.

Operator detail lives in the docs, not this README:

- collection paths by environment: [`docs/operators/collection-paths.md`](docs/operators/collection-paths.md)
- Sources, enrollment, and job lifecycle: [`docs/operators/sources-and-agents.md`](docs/operators/sources-and-agents.md)
- typed collection scope and current non-Linux limits: [`docs/operators/job-scoped-collection.md`](docs/operators/job-scoped-collection.md)
- deployment and security posture: [`docs/agent-deployment.md`](docs/agent-deployment.md)

## Compare, Reanalyze, and Fresh Evidence

SignalForge keeps these concepts separate:

- **Reanalyze**: analyze the same stored artifact again
- **Compare**: diff two runs
- **Collect fresh evidence**: register a Source, create a collection job, and run [signalforge-agent](https://github.com/Canepro/signalforge-agent) on the host — collection stays external to SignalForge

Important:

- implicit compare uses the latest older run for the same logical target
- that is **not always** the same as the reanalyze parent
- if you want an exact baseline, use explicit `against`

Examples:

```bash
./scripts/signalforge-read.sh compare <run-id>
./scripts/signalforge-read.sh compare <run-id> --against <other-run-id>
```

The run-detail UI also exposes a **vs parent** path when lineage exists.

## Current Status

Canonical roadmap:

- [`plans/roadmap.md`](plans/roadmap.md)

Current shipped snapshot:

- [`plans/current-plan.md`](plans/current-plan.md)

Completed at a high level:

- analyzer core
- persistence and APIs
- dashboard UI
- reanalyze flow
- compare UI + compare JSON API
- CLI submit + read helpers
- ingestion metadata contract
- target-aware compare and baseline logic
- external submit contract docs
- published API contract and schemas
- Sources UI + collection jobs + agent enrollment
- storage abstraction (SQLite + Postgres)
- Vercel deployment with Neon Postgres
- CI workflow (GitHub Actions: typecheck, test, build, Postgres parity)
- Postgres migration policy with checksum enforcement

Historical background only:

- [`plans/mvp.md`](plans/mvp.md)
- [`plans/phase-2-ui.md`](plans/phase-2-ui.md)

## Current Scope

Current shipped artifact families in this checkout:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

Current strengths:

- disk pressure
- pending upgrades
- SSH posture
- listener exposure
- incomplete or truncated log detection
- WSL and non-root noise suppression

Current limitations:

- Kubernetes support is still a first slice built around the `kubernetes-bundle.v1` JSON manifest, not raw support-bundle archive ingestion
- recommendations are bounded by captured evidence
- findings quality will continue to improve as more real logs are reviewed

Longer-term direction remains broader:

- Linux / WSL
- servers / VMs
- containers
- Kubernetes bundles
- Windows
- macOS

That broader support will come from new artifact families and external collectors over time, not from turning SignalForge into a privileged execution engine.

## LLM Provider Support

SignalForge supports:

- OpenAI direct
- Azure OpenAI **Responses** (`client.responses.create`) with **two endpoint styles** (see below)

If provider configuration is missing or invalid, SignalForge uses a deterministic fallback.

## Environment Variables

### LLM provider

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_PROVIDER` | No | `openai` | `openai` (platform API) or `azure` (Azure OpenAI). Invalid values fall back to deterministic analysis. |
| `OPENAI_API_KEY` | If `openai` | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-5-mini` | Model name for OpenAI direct |
| `AZURE_OPENAI_ENDPOINT` | If `azure` | — | See **Azure endpoint styles** below |
| `AZURE_OPENAI_API_KEY` | If `azure` | — | Azure API key |
| `AZURE_OPENAI_API_VERSION` | Legacy Azure only | — | Required for resource-root URLs; **omit** for `/openai/v1` bases (ignored if set) |
| `AZURE_OPENAI_DEPLOYMENT` | If `azure` | — | Deployment name passed as the Responses API `model` parameter (e.g. `gpt-5.4-mini`) |

**Azure endpoint styles**

1. **Legacy (resource root)** — e.g. `https://your-name.cognitiveservices.azure.com` or `https://your-name.openai.azure.com` **without** `/openai/v1` in the path. SignalForge appends `/openai` and sends `api-version` on every request. **`AZURE_OPENAI_API_VERSION` is required** (e.g. `2025-04-01-preview`).
2. **OpenAI v1 base URL** — e.g. `https://your-name.openai.azure.com/openai/v1/` (trailing slash optional). Use the URL **as provided**; SignalForge does **not** append `/openai`. **Do not set `AZURE_OPENAI_API_VERSION`** for this style — Azure returns *400 API version not supported* if `api-version` is sent on v1 bases; any value in env is ignored for v1 clients.

If `LLM_PROVIDER=azure` and required variables for the chosen style are missing, SignalForge does **not** call the cloud API and uses deterministic fallback.

### App

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_DRIVER` | No | `sqlite` | Storage backend selector: `sqlite` or `postgres` |
| `DATABASE_PATH` | If `DATABASE_DRIVER=sqlite` | `./signalforge.db` | SQLite file path for local/self-hosted persistence |
| `DATABASE_URL` | If `DATABASE_DRIVER=postgres` | — | Postgres connection string for durable remote persistence |
| `SIGNALFORGE_ADMIN_TOKEN` | **Yes** for Phase 6 operator APIs + `/sources` UI | — | Bootstrap secret: `Authorization: Bearer …` on `/api/sources`, `/api/collection-jobs/*`, `/api/agent/registrations`. If unset, those routes return **503**. The dashboard **Sources** area (`/sources`) signs in via `/sources/login` (httpOnly cookie); the token is not embedded in the client bundle. |
| `PORT` | No | `3000` | Container/server listen port |
| `HOSTNAME` | No | runtime default | Host bind value for container/server entrypoints |

Copy `.env.example` to `.env.local` for Next, or export vars in your shell for direct analyzer and helper usage.

### Storage backends

Local development defaults to SQLite:

```env
DATABASE_DRIVER=sqlite
DATABASE_PATH=./signalforge.db
```

For durable serverless or multi-instance deployment, use Postgres:

```env
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://user:password@host:5432/signalforge
```

Before starting the app on Postgres, apply the checked-in SQL migrations:

```bash
bun run db:migrate:postgres
```

For local Postgres parity validation, prefer:

```bash
bash scripts/run-postgres-parity-local.sh
```

That helper will use `--url` if provided, otherwise `DATABASE_URL_TEST` / `DATABASE_URL`, otherwise it will try to detect a local Podman container such as `signalforge-pg`.

SQLite remains the easiest local quickstart path. Postgres is the recommended production backend. The live Vercel deployment uses Neon Postgres.

For the Phase 10 containerization slice, keep production containers on `DATABASE_DRIVER=postgres` with Neon or another managed Postgres target. Do not switch the first ACA cut to SQLite. Container build and runtime details: [`docs/app-container-runtime.md`](docs/app-container-runtime.md).

## CI

GitHub Actions runs on every push to `main` and on pull requests:

- **Checks job:** `bun run typecheck`, `bun run test`, `bun run build`
- **Postgres parity job:** starts `postgres:16-alpine`, applies migrations, runs `bun run test:parity`
- **Bun version:** pinned in the workflow (currently `1.3.11`) so CI does not depend on `latest`

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

Postgres schema changes must follow the checked-in migration policy: [`docs/postgres-migrations.md`](docs/postgres-migrations.md).

## More Documentation

- beginner setup and usage: [`docs/getting-started.md`](docs/getting-started.md)
- docs index: [`docs/README.md`](docs/README.md)
- operator docs: [`docs/operators/README.md`](docs/operators/README.md)
- HTTP routes and response shapes: [`docs/api-contract.md`](docs/api-contract.md)
- ACA app contract: [`docs/aca-app-deployment.md`](docs/aca-app-deployment.md)
- ACA env contract: [`docs/aca-env-contract.md`](docs/aca-env-contract.md)
- ACA staging runbook: [`docs/aca-staging-runbook.md`](docs/aca-staging-runbook.md)
- Postgres migration policy: [`docs/postgres-migrations.md`](docs/postgres-migrations.md)
- Postgres validation runbook: [`docs/postgres-validation.md`](docs/postgres-validation.md)
- external collector and CI submission: [`docs/external-submit.md`](docs/external-submit.md)
- JSON schemas: [`docs/schemas/README.md`](docs/schemas/README.md)
- roadmap: [`plans/roadmap.md`](plans/roadmap.md)
- current state: [`plans/current-plan.md`](plans/current-plan.md)

## Technical Notes

### sql.js / deployment

The DB client uses `initSqlJs({ locateFile: ... })` so the WASM can be resolved from the normal `node_modules/sql.js/dist/` path or from traced standalone output.

For serverless or edge-style deployments, ensure the `.wasm` asset is included in the output or copied to a path that `locateFile` can resolve.

For the current ACA migration slice, the committed production container uses a Bun build stage and a Node runtime stage with Next standalone output.

### Fixture logs

Test fixtures in `tests/fixtures/` are copied from `signalforge-collectors`.

See:

- [`tests/fixtures/README.md`](tests/fixtures/README.md)

## License

MIT
