# SignalForge

**Infrastructure Diagnostics** for evidence artifacts.

SignalForge is an operator-first control plane for infrastructure evidence.

It ingests external diagnostics, turns them into deterministic findings plus one explanation pass, stores immutable artifacts and runs, and helps operators answer three practical questions:

- what did this artifact show?
- what changed since the last run?
- what should I do now?

SignalForge currently supports three artifact families:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

That means Linux and WSL audit logs in the `signalforge-collectors` style, text-based container diagnostics for a single container or workload, and UTF-8 JSON Kubernetes evidence bundles.

## Repo Boundary

SignalForge is the analysis and control-plane repo.

- this repo ingests, analyzes, stores, and presents evidence
- `signalforge-collectors` produces evidence artifacts
- `signalforge-agent` runs job-driven collection and uploads artifacts back to SignalForge

That separation is intentional. SignalForge is not the collector runtime.

## What SignalForge Is

SignalForge is an **analysis and control-plane product**, not a collector.

It currently does these things well:

- ingests external evidence artifacts
- extracts deterministic findings
- uses one LLM call for explanation and prioritization
- stores immutable artifacts and per-analysis runs
- exposes results through UI, APIs, and CLI helpers
- supports job-driven collection through external agents and collectors

It does **not** currently:

- SSH into servers
- run `kubectl` from inside the app
- execute collectors inside the app
- perform remediation from the current product

Collection stays external by design. Remediation remains deferred and would require a separate higher-trust model if introduced later.

## Tech Stack

- **Framework:** Next.js (App Router)
- **Runtime:** Bun
- **Language:** TypeScript
- **UI:** React, Tailwind CSS
- **Local DB:** SQLite via `sql.js`
- **Durable DB:** Postgres / Neon
- **Testing:** Vitest
- **CI:** GitHub Actions
- **App-hosting path:** Dockerized app with Azure Container Apps
- **Preview/review path:** Vercel previews

## Deployment Surfaces

The repo currently documents three deployment surfaces that should not be conflated:

- **Local development:** SQLite by default
- **Preview/review:** Vercel-compatible branch and PR previews
- **App-hosting path:** Azure Container Apps with `DATABASE_DRIVER=postgres`

Current deployment docs:

- [docs/aca-app-deployment.md](docs/aca-app-deployment.md)
- [docs/aca-env-contract.md](docs/aca-env-contract.md)
- [docs/aca-app-runbook.md](docs/aca-app-runbook.md)
- [plans/phase-10b-aca-resource-rename-cutover.md](plans/phase-10b-aca-resource-rename-cutover.md)
- [plans/phase-10c-public-image-and-release-pipeline.md](plans/phase-10c-public-image-and-release-pipeline.md)

Reference operator deployment:

- app URL: `https://signalforge.canepro.me`
- preview or review: Vercel remains separate from the live ACA app path

## Start Here

If you are new to the repo:

1. [docs/getting-started.md](docs/getting-started.md)
2. [docs/README.md](docs/README.md)
3. [AGENTS.md](AGENTS.md)
4. [plans/roadmap.md](plans/roadmap.md)
5. [plans/current-plan.md](plans/current-plan.md)

If you are integrating with SignalForge:

- [docs/api-contract.md](docs/api-contract.md)
- [docs/external-submit.md](docs/external-submit.md)
- [docs/schemas/README.md](docs/schemas/README.md)

If you are operating Sources, agents, or collection jobs:

- [docs/operators/README.md](docs/operators/README.md)
- [docs/agent-deployment.md](docs/agent-deployment.md)

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

For the step-by-step version, use [docs/getting-started.md](docs/getting-started.md).

## Current Product Shape

SignalForge currently supports:

- artifact upload and review
- run detail, compare, and reanalyze
- CLI and HTTP consumption
- Sources, collection jobs, and agent enrollment
- external job-driven collection via `signalforge-agent`

Related operator docs:

- [docs/operators/collection-paths.md](docs/operators/collection-paths.md)
- [docs/operators/sources-and-agents.md](docs/operators/sources-and-agents.md)
- [docs/operators/job-scoped-collection.md](docs/operators/job-scoped-collection.md)
- [docs/agent-deployment.md](docs/agent-deployment.md)

## LLM Provider Support

SignalForge supports:

- OpenAI direct
- Azure OpenAI Responses API

If provider configuration is missing or invalid, SignalForge uses a deterministic fallback.

### LLM variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_PROVIDER` | No | `openai` | `openai` or `azure` |
| `OPENAI_API_KEY` | If `openai` | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-5-mini` | OpenAI model override |
| `AZURE_OPENAI_ENDPOINT` | If `azure` | — | Azure endpoint |
| `AZURE_OPENAI_API_KEY` | If `azure` | — | Azure API key |
| `AZURE_OPENAI_API_VERSION` | Legacy Azure only | — | Required for resource-root URLs, omit for `/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT` | If `azure` | — | Deployment name passed as Responses `model` |

## App Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_DRIVER` | No | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_PATH` | If `sqlite` | `./signalforge.db` | Local SQLite path |
| `DATABASE_URL` | If `postgres` | — | Postgres connection string |
| `SIGNALFORGE_ADMIN_TOKEN` | Yes for Sources and agent/operator APIs | — | Admin bootstrap token |
| `PORT` | No | `3000` | Listen port |
| `HOSTNAME` | No | runtime default | Bind host |

For Postgres:

```bash
bun run db:migrate:postgres
```

For older agent-created rows missing inferred `collected_at`:

```bash
bun run db:backfill:collected-at
```

For local Postgres parity:

```bash
bash scripts/run-postgres-parity-local.sh
```

## CI And Release

GitHub Actions now covers:

- `CI`: typecheck, test, build, and Postgres parity on pushes to `main` and on pull requests
- `Publish App Image`: repo-owned GHCR image publication after successful `CI` on `main`
- `Deploy ACA App`: manual-dispatch ACA deployment using a chosen published image tag

See:

- [.github/workflows/ci.yml](.github/workflows/ci.yml)
- [.github/workflows/publish-app-image.yml](.github/workflows/publish-app-image.yml)
- [.github/workflows/deploy-aca-app.yml](.github/workflows/deploy-aca-app.yml)

## Current Priorities

The highest-signal current infrastructure and release work is now:

- keep the repo-owned GHCR publish and ACA deploy path healthy
- keep Vercel strictly in the preview or review role
- keep the cross-repo operator contract portable across app, agent, and collectors
- avoid turning one operator's machine, registry, or cluster into the canonical product model

Source-of-truth plans:

- [plans/phase-10b-aca-resource-rename-cutover.md](plans/phase-10b-aca-resource-rename-cutover.md)
- [plans/phase-10c-public-image-and-release-pipeline.md](plans/phase-10c-public-image-and-release-pipeline.md)
- [plans/current-plan.md](plans/current-plan.md)

## More Documentation

- [docs/README.md](docs/README.md)
- [docs/api-contract.md](docs/api-contract.md)
- [docs/external-submit.md](docs/external-submit.md)
- [docs/postgres-migrations.md](docs/postgres-migrations.md)
- [docs/postgres-validation.md](docs/postgres-validation.md)
- [docs/aca-app-deployment.md](docs/aca-app-deployment.md)
- [docs/aca-env-contract.md](docs/aca-env-contract.md)
- [docs/app-release-and-aca-deploy.md](docs/app-release-and-aca-deploy.md)
- [docs/infisical-secrets.md](docs/infisical-secrets.md)
- [docs/aca-app-runbook.md](docs/aca-app-runbook.md)
- [docs/aca-cutover-runbook.md](docs/aca-cutover-runbook.md)
- [docs/history.md](docs/history.md)
- [plans/roadmap.md](plans/roadmap.md)
- [plans/current-plan.md](plans/current-plan.md)

## License

MIT
