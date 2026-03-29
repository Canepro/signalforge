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

### I operate Sources, agents, or collection jobs

1. [`operators/README.md`](./operators/README.md)
2. [`operators/sources-and-agents.md`](./operators/sources-and-agents.md)
3. [`operators/collection-paths.md`](./operators/collection-paths.md)
4. [`agent-deployment.md`](./agent-deployment.md)

### I am an agent working in the repo

1. [`../AGENTS.md`](../AGENTS.md)
2. [`../plans/roadmap.md`](../plans/roadmap.md)
3. [`../plans/current-plan.md`](../plans/current-plan.md)
4. then the specific docs below

## Documentation Map

| Document | Use it for |
|---|---|
| [`getting-started.md`](./getting-started.md) | Beginner-friendly setup and first successful run |
| [`operators/README.md`](./operators/README.md) | Operator docs entrypoint for Sources, agents, collection jobs, and current execution guidance |
| [`operators/sources-and-agents.md`](./operators/sources-and-agents.md) | Sources UI, enrollment, collection-job lifecycle, and the control-plane / execution-plane split |
| [`operators/collection-paths.md`](./operators/collection-paths.md) | Honest push-first vs job-driven collection guidance by environment |
| [`operators/job-scoped-collection.md`](./operators/job-scoped-collection.md) | Typed collection-scope model, source defaults, job overrides, and remaining cross-repo limits |
| [`agent-deployment.md`](./agent-deployment.md) | Preferred `signalforge-agent` deployment model, trust boundaries, and security baseline |
| [`api-contract.md`](./api-contract.md) | Current HTTP routes, request shapes, response shapes, and stability notes |
| [`external-submit.md`](./external-submit.md) | Sending evidence into SignalForge from scripts, CI, or external collectors |
| [`history.md`](./history.md) | Running project history log for milestones, migration triggers, validations, and major operating decisions |
| [`app-container-runtime.md`](./app-container-runtime.md) | Slice 1 app-container runtime contract, health checks, and local smoke guidance before ACA-specific rollout work |
| [`aca-env-contract.md`](./aca-env-contract.md) | Slice 2 ACA environment contract, including secret classification and required app variables |
| [`aca-app-deployment.md`](./aca-app-deployment.md) | Slice 2 ACA app shape, ingress, revisions, replica policy, and rollout contract |
| [`aca-staging-runbook.md`](./aca-staging-runbook.md) | Slice 3 staging deployment runbook using the checked-in ACA template and parameter contract |
| [`postgres-migrations.md`](./postgres-migrations.md) | Postgres migration policy, rollback stance, and release discipline |
| [`postgres-validation.md`](./postgres-validation.md) | Reproducible live validation notes for the Postgres backend |
| [`schemas/README.md`](./schemas/README.md) | Lightweight JSON Schemas for the published API contract |
| [`../AGENTS.md`](../AGENTS.md) | Repo-local instructions, architecture, and working rules for future agents |
| [`../plans/roadmap.md`](../plans/roadmap.md) | Long-lived product roadmap and future direction |
| [`../plans/current-plan.md`](../plans/current-plan.md) | Current shipped state and recommended next work |
| [`../plans/phase-10-aca-migration.md`](../plans/phase-10-aca-migration.md) | Production hosting migration plan from Vercel to Azure Container Apps |
| [`../plans/phase-9c-frontend-operator-workstation-polish.md`](../plans/phase-9c-frontend-operator-workstation-polish.md) | Frontend redesign and interaction-polish source of truth for the operator workstation pass |
| [`../plans/phase-9c-stabilization-checklist.md`](../plans/phase-9c-stabilization-checklist.md) | Post-implementation gate for preview QA, browser validation, and final Phase 9c signoff |
| [`../plans/phase-7-storage-abstraction.md`](../plans/phase-7-storage-abstraction.md) | Planned storage abstraction and multi-backend persistence direction |

## What SignalForge Covers Today

SignalForge currently supports three artifact families in this checkout:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

That includes Linux and WSL audit logs in the `signalforge-collectors` style, text-based container diagnostics, and UTF-8 JSON Kubernetes evidence bundles.

SignalForge is strongest today on:

- artifact ingestion
- deterministic findings
- run detail and compare workflows
- CLI and API consumption
- external push submission
- job-driven collection via `signalforge-agent` (sibling repo, not yet published)

For the preferred job-driven deployment model and security stance, see [`agent-deployment.md`](./agent-deployment.md).

## What These Docs Do Not Promise Yet

- in-product collectors
- auth or multi-user deployment guidance
- scheduling
- fleet management
- remediation in the current product scope
- raw archive ingestion for Kubernetes support bundles
- fully general non-Linux job-driven collection on arbitrary hosts without explicit runtime, kubeconfig, or RBAC preparation

Those remain current limitations or future design topics in the repo plans. Remediation is deferred, not permanently ruled out, and would require a separate higher-trust model if introduced later.

## Storage Note

SignalForge now supports two persistence backends at the app boundary:

- `sqlite` for local development and simple self-hosting
- `postgres` for durable remote/serverless deployment

Use `DATABASE_DRIVER` to select the backend. For Postgres, set `DATABASE_URL` and run `bun run db:migrate:postgres` before starting the app. If older agent-created runs need timestamp repair, run `bun run db:backfill:collected-at`. Migration discipline: [`postgres-migrations.md`](./postgres-migrations.md).

## Deployment

The live SignalForge instance runs on Vercel with a Neon Postgres backend. Local development defaults to SQLite.

Vercel preview deployments are also available for branches and pull requests, so product and UI changes can be reviewed on a live preview before merging to remote `main`.

## CI

GitHub Actions runs typecheck, tests, build, and a Postgres parity job on every push to `main` and on pull requests. See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
