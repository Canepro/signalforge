# SignalForge Documentation

Use this folder as the documentation entrypoint after the top-level `README.md`.

## Recommended Reading Paths

### I am completely new

1. [`../README.md`](../README.md)
2. [`getting-started.md`](./getting-started.md)
3. [`../plans/roadmap.md`](../plans/roadmap.md)
4. [`../plans/current-plan.md`](../plans/current-plan.md)

### I want to use the API or scripts

1. [`api-contract.md`](./api-contract.md)
2. [`external-submit.md`](./external-submit.md)
3. [`schemas/README.md`](./schemas/README.md)

### I am an agent working in the repo

1. [`../AGENTS.md`](../AGENTS.md)
2. [`../plans/roadmap.md`](../plans/roadmap.md)
3. [`../plans/current-plan.md`](../plans/current-plan.md)
4. then the specific docs below

## Documentation Map

| Document | Use it for |
|---|---|
| [`getting-started.md`](./getting-started.md) | Beginner-friendly setup and first successful run |
| [`api-contract.md`](./api-contract.md) | Current HTTP routes, request shapes, response shapes, and stability notes |
| [`external-submit.md`](./external-submit.md) | Sending evidence into SignalForge from scripts, CI, or external collectors |
| [`postgres-migrations.md`](./postgres-migrations.md) | Postgres migration policy, rollback stance, and release discipline |
| [`postgres-validation.md`](./postgres-validation.md) | Reproducible live validation notes for the Postgres backend |
| [`schemas/README.md`](./schemas/README.md) | Lightweight JSON Schemas for the published API contract |
| [`../AGENTS.md`](../AGENTS.md) | Repo-local instructions, architecture, and working rules for future agents |
| [`../plans/roadmap.md`](../plans/roadmap.md) | Long-lived product roadmap and future direction |
| [`../plans/current-plan.md`](../plans/current-plan.md) | Current shipped state and recommended next work |
| [`../plans/phase-7-storage-abstraction.md`](../plans/phase-7-storage-abstraction.md) | Planned storage abstraction and multi-backend persistence direction |

## What SignalForge Covers Today

SignalForge currently ships one artifact family:

- `linux-audit-log`

That includes Linux and WSL audit logs in the `signalforge-collectors` style.

SignalForge is strongest today on:

- artifact ingestion
- deterministic findings
- run detail and compare workflows
- CLI and API consumption
- external push submission
- job-driven collection via `signalforge-agent` (sibling repo, not yet published)

## What These Docs Do Not Promise Yet

- in-product collectors
- auth or multi-user deployment guidance
- scheduling
- fleet management
- remediation
- broad multi-artifact support beyond the currently shipped path

Those remain current limitations or future design topics in the repo plans.

## Storage Note

SignalForge now supports two persistence backends at the app boundary:

- `sqlite` for local development and simple self-hosting
- `postgres` for durable remote/serverless deployment

Use `DATABASE_DRIVER` to select the backend. For Postgres, set `DATABASE_URL` and run `bun run db:migrate:postgres` before starting the app.
