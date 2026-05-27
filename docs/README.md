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
3. [`operators/automation-agent-integration.md`](./operators/automation-agent-integration.md)
4. [`schemas/README.md`](./schemas/README.md)

### I operate Sources, agents, or collection jobs

1. [`operators/README.md`](./operators/README.md)
2. [`operators/sources-and-agents.md`](./operators/sources-and-agents.md)
3. [`operators/automation-agent-integration.md`](./operators/automation-agent-integration.md)
4. [`operators/autonomous-kubernetes-actions.md`](./operators/autonomous-kubernetes-actions.md)
5. [`operators/collection-paths.md`](./operators/collection-paths.md)
6. [`agent-deployment.md`](./agent-deployment.md)

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
| [`operators/automation-agent-integration.md`](./operators/automation-agent-integration.md) | Source-bound automation-agent setup, HTTP connection model, and helper-script workflow for external AI agents |
| [`operators/source-inventory-map.md`](./operators/source-inventory-map.md) | Canonical map of every planned and enrolled diagnostic Source: target identifier, artifact family, credential store, and automation-agent access |
| [`operators/automation-agent-multi-source-enrollment.md`](./operators/automation-agent-multi-source-enrollment.md) | Per-source automation-agent token naming, Infisical secret names, host file paths, enrollment steps, and discovery model |
| [`operators/automation-agent-source-wrappers.md`](./operators/automation-agent-source-wrappers.md) | Per-source wrapper contract and template scripts for automation-agent diagnostic requests |
| [`operators/automation-agent-wrapper-deployment-checklist.md`](./operators/automation-agent-wrapper-deployment-checklist.md) | Deployment checklists, rollback procedures, operator verification report template |
| [`operators/automation-agent-codex-app-server-integration.md`](./operators/automation-agent-codex-app-server-integration.md) | Automation-agent vs Codex App Server analysis brain roles, scopes, and Infisical secret boundaries |
| [`operators/codex-brain-artifact-quality-pass.md`](./operators/codex-brain-artifact-quality-pass.md) | Mandatory-fixture Codex brain quality review notes and verification commands |
| [`operators/autonomous-kubernetes-actions.md`](./operators/autonomous-kubernetes-actions.md) | Autonomous Kubernetes signal and safe-fix action model, including trust boundaries and required capabilities |
| [`../examples/automation_agent_client.py`](../examples/automation_agent_client.py) | Minimal dependency-free example client for external agents consuming the automation-agent API |
| [`../examples/recommendation_handoff.py`](../examples/recommendation_handoff.py) | Recommendation-only handoff builder that wraps SignalForge summaries without granting execution rights |
| [`operators/collection-paths.md`](./operators/collection-paths.md) | Honest push-first vs job-driven collection guidance by environment |
| [`operators/job-scoped-collection.md`](./operators/job-scoped-collection.md) | Typed collection-scope model, source defaults, job overrides, and remaining cross-repo limits |
| [`agent-deployment.md`](./agent-deployment.md) | Preferred `signalforge-agent` deployment model, trust boundaries, and security baseline |
| [`api-contract.md`](./api-contract.md) | Current HTTP routes, request shapes, response shapes, and stability notes |
| [`external-submit.md`](./external-submit.md) | Sending evidence into SignalForge from scripts, CI, or external collectors |
| [`../scripts/verify-automation-agent-local.sh`](../scripts/verify-automation-agent-local.sh) | One-command local end-to-end verification for automation-agent request, execution-agent fulfillment, and findings polling |
| [`../scripts/verify-codex-app-server-brain.sh`](../scripts/verify-codex-app-server-brain.sh) | One-command local fixture verification for the Codex App Server analysis brain provider |
| [`history.md`](./history.md) | Running project history log for milestones, migration triggers, validations, and major operating decisions |
| [`ui-system-direction.md`](./ui-system-direction.md) | Current UI-system decision, including how SignalForge should treat `shadcn/ui` versus the existing `sf-*` design primitives |
| [`app-container-runtime.md`](./app-container-runtime.md) | Slice 1 app-container runtime contract, health checks, and local verification guidance before ACA-specific rollout work |
| [`aca-env-contract.md`](./aca-env-contract.md) | Slice 2 ACA environment contract, including secret classification and required app variables |
| [`aca-app-deployment.md`](./aca-app-deployment.md) | Slice 2 ACA app shape, ingress, revisions, replica policy, and rollout contract |
| [`app-release-and-aca-deploy.md`](./app-release-and-aca-deploy.md) | Repo-owned GHCR image publication, GitHub Actions deploy flow, and the portable ACA release contract |
| [`infisical-secrets.md`](./infisical-secrets.md) | Infisical OIDC setup for GitHub Actions deploys and local SignalForge secret workflows |
| [`aca-app-runbook.md`](./aca-app-runbook.md) | ACA app runbook using the checked-in ACA template without assuming one operator's Azure layout |
| [`aca-cutover-runbook.md`](./aca-cutover-runbook.md) | Legacy-name migration guide for operators still replacing an older ACA app name with `ca-signalforge` |
| [`postgres-migrations.md`](./postgres-migrations.md) | Postgres migration policy, rollback stance, and release discipline |
| [`postgres-validation.md`](./postgres-validation.md) | Reproducible live validation notes for the Postgres backend |
| [`schemas/README.md`](./schemas/README.md) | Lightweight JSON Schemas for the published API contract |
| [`../AGENTS.md`](../AGENTS.md) | Repo-local instructions, architecture, and working rules for future agents |
| [`../plans/roadmap.md`](../plans/roadmap.md) | Long-lived product roadmap and future direction |
| [`../plans/current-plan.md`](../plans/current-plan.md) | Current shipped state and recommended next work |
| [`../plans/phase-10-aca-migration.md`](../plans/phase-10-aca-migration.md) | Production hosting migration plan from Vercel to Azure Container Apps |
| [`../plans/phase-10b-aca-resource-rename-cutover.md`](../plans/phase-10b-aca-resource-rename-cutover.md) | Historical implementation plan for the legacy-name ACA cutover |
| [`../plans/phase-10c-public-image-and-release-pipeline.md`](../plans/phase-10c-public-image-and-release-pipeline.md) | Public GHCR image and repo-owned release-pipeline plan |
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

The repo currently documents and ships three deployment surfaces:

- local development with SQLite by default
- ACA or local browser review by default, with optional manual Vercel preview only when intentionally needed
- a committed container + ACA deployment path for the app itself

Code and infra sources of truth:

- container runtime: [`../Dockerfile`](../Dockerfile), [`app-container-runtime.md`](./app-container-runtime.md)
- ACA contract: [`aca-env-contract.md`](./aca-env-contract.md), [`aca-app-deployment.md`](./aca-app-deployment.md), [`aca-app-runbook.md`](./aca-app-runbook.md)
- migration plan: [`../plans/phase-10-aca-migration.md`](../plans/phase-10-aca-migration.md)
- ACA operating history: [`history.md`](./history.md)

Keep the wording precise:

- do not describe Vercel as the only deployment environment
- do not describe Vercel as the main app-hosting path
- do not describe Vercel as an automatic branch or PR deployment path
- do describe ACA as the app-hosting path when that distinction matters
- do treat legacy `staging` names as historical resource identifiers rather than the canonical environment taxonomy

## CI And Release

GitHub Actions now covers:

- `CI`: typecheck, tests, build, and Postgres parity on pushes to `main` and on pull requests
- `Publish App Image`: public GHCR image publication after successful `CI` on `main`
- `Deploy ACA App`: manual-dispatch ACA deployment with Azure OIDC and explicit image-tag selection

See:

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- [`.github/workflows/publish-app-image.yml`](../.github/workflows/publish-app-image.yml)
- [`.github/workflows/deploy-aca-app.yml`](../.github/workflows/deploy-aca-app.yml)
