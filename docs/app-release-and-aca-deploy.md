# App Release And ACA Deploy

This document is the repo-owned release and deploy contract for the SignalForge app.

It keeps three concerns separate on purpose:

- preview and review stay on Vercel
- app-image publishing happens on GHCR
- the primary app runs on Azure Container Apps

That keeps rollback and operator ownership straightforward.

## Current verified baseline

Verified on April 1, 2026 from this repo checkout and live read-only infra:

- GitHub Actions currently has one checked-in repo workflow for CI plus the GitHub-provided Copilot workflow
- the live app resource is still `ca-signalforge-staging`
- the live app is public, runs in `rg-canepro-ph-dev-eus`, and uses `caneprophacr01.azurecr.io/signalforge:staging-68fa777`
- there is not yet a live `ca-signalforge` app

This document describes the repo-owned path that replaces the manual ACR-to-ACA release muscle memory.

## Release shape

### 1. CI remains the gate

`.github/workflows/ci.yml` still owns typecheck, tests, build, and Postgres parity.

### 2. Publish the app image after CI passes on `main`

`.github/workflows/publish-app-image.yml` is the canonical image-publish workflow.

It triggers:

- automatically after a successful `CI` run for a push to `main`
- manually with `workflow_dispatch` when you need to republish a specific ref

It builds the checked-in `Dockerfile` and pushes:

- `ghcr.io/canepro/signalforge:<full-commit-sha>`
- `ghcr.io/canepro/signalforge:<12-char-sha>`
- `ghcr.io/canepro/signalforge:main`

The full commit SHA tag is the deploy-grade tag.
The short SHA and `main` tags are convenience tags.

### 3. Enforce public pullability

The publish workflow checks the GHCR package visibility after push.

If the package is not public, the workflow fails and tells the operator to change the package visibility in GitHub Packages.

That means public pullability is an enforced release condition, not a hope.

## Deploy shape

### 1. Deploy is manual-dispatch and explicit

`.github/workflows/deploy-aca-app.yml` is the repo-owned ACA deploy workflow.

It requires a chosen `image_tag` and defaults to:

- app name: `ca-signalforge`
- mode: `what-if=true`

That keeps release and deploy separate and makes the first deployment action non-destructive by default.

### 2. Azure auth uses OIDC

The deploy workflow uses `azure/login` with GitHub OIDC.

Required GitHub environment secrets in the `aca-primary` environment:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `ACA_PRIMARY_DATABASE_URL`
- `ACA_PRIMARY_ADMIN_TOKEN`

Optional GitHub environment secrets:

- `ACA_PRIMARY_OPENAI_API_KEY`
- `ACA_PRIMARY_AZURE_OPENAI_API_KEY`

Required GitHub environment variables in the `aca-primary` environment:

- `ACA_PRIMARY_RESOURCE_GROUP`
- `ACA_PRIMARY_ENVIRONMENT_ID`

Optional GitHub environment variables:

- `ACA_PRIMARY_CPU`
- `ACA_PRIMARY_MEMORY`
- `ACA_PRIMARY_MIN_REPLICAS`
- `ACA_PRIMARY_MAX_REPLICAS`
- `ACA_PRIMARY_TARGET_PORT`
- `ACA_PRIMARY_LLM_PROVIDER`
- `ACA_PRIMARY_OPENAI_MODEL`
- `ACA_PRIMARY_AZURE_OPENAI_ENDPOINT`
- `ACA_PRIMARY_AZURE_OPENAI_DEPLOYMENT`
- `ACA_PRIMARY_AZURE_OPENAI_API_VERSION`

### 3. The deploy workflow calls the checked-in shell helper

`scripts/deploy-aca-app.sh` is the local and CI-safe deploy entrypoint.

It wraps:

- `infra/aca/main.bicep`
- explicit required inputs
- derived revision suffixes for SHA-tag deploys
- `az deployment group what-if`
- `az deployment group create`

The script defaults to the primary-role contract:

- `ca-signalforge`
- `environment=primary`
- `slice=aca-primary`
- `DATABASE_DRIVER=postgres`
- public ingress on port `3000`

### 4. Post-deploy checks are built in

After a non-`what-if` deploy, the workflow resolves the ACA hostname and runs:

- `bash scripts/check-aca-app.sh https://<fqdn>`

That script checks:

- `GET /api/health`
- `GET /api/runs`
- `GET /api/sources` when an admin token is available

## Local operator fallback

If you want the exact same deploy path outside GitHub Actions, use the checked-in helper directly:

```bash
ACA_DATABASE_URL='postgres://<user>:<password>@<host>/<db>?sslmode=require' \
ACA_ADMIN_TOKEN='<long-random-secret>' \
ACA_AZURE_OPENAI_API_KEY='<azure-openai-key>' \
bash scripts/deploy-aca-app.sh \
  --resource-group rg-canepro-ph-dev-eus \
  --environment-id /subscriptions/<subscription-id>/resourceGroups/rg-canepro-ph-dev-eus/providers/Microsoft.App/managedEnvironments/cae-canepro-ph-dev-eus \
  --image ghcr.io/canepro/signalforge:<full-commit-sha> \
  --llm-provider azure \
  --azure-openai-endpoint https://Signalforge-resource.openai.azure.com/openai/v1/ \
  --azure-openai-deployment gpt-5.4-mini \
  --what-if
```

Then remove `--what-if` for the real deploy.

## Recommended operator sequence

1. Merge to `main`.
2. Let `CI` pass.
3. Let `Publish App Image` publish the GHCR image.
4. Confirm the package is public and copy the immutable full SHA tag.
5. Run `Deploy ACA App` with that full SHA tag.
6. Start with `what_if=true`.
7. Rerun with `what_if=false` once the plan looks correct.
8. Run the deeper cutover or traffic-move steps from `aca-cutover-runbook.md` when replacing `ca-signalforge-staging`.
