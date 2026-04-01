# App Release And ACA Deploy

This document is the repo-owned release and deploy contract for the SignalForge app.

It keeps three concerns separate on purpose:

- preview and review stay on Vercel
- app-image publishing happens on GHCR
- the app runs on Azure Container Apps
- operator-owned public domains bind to the ACA app, not to Vercel preview URLs

That keeps rollback and operator ownership straightforward without baking one operator's Azure layout into the product contract.

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
- mode: `what_if=true`

That keeps release and deploy separate and makes the first deployment action non-destructive by default.

### 2. Azure auth uses OIDC

The deploy workflow uses `azure/login` with GitHub OIDC.
It now pins `azure/login@v3` and forces JavaScript actions onto Node 24 so the deploy path is ahead of the GitHub-hosted Node 20 deprecation window.

Required GitHub environment vars in the deploy environment:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Required GitHub environment vars for ACA deployment:

- `ACA_APP_RESOURCE_GROUP`
- `ACA_APP_ENVIRONMENT_ID`

Optional GitHub environment vars:

- `ACA_APP_CPU`
- `ACA_APP_MEMORY`
- `ACA_APP_MIN_REPLICAS`
- `ACA_APP_MAX_REPLICAS`
- `ACA_APP_TARGET_PORT`
- `ACA_APP_CUSTOM_DOMAINS_JSON`
- `ACA_APP_LLM_PROVIDER`
- `ACA_APP_OPENAI_MODEL`
- `ACA_APP_AZURE_OPENAI_ENDPOINT`
- `ACA_APP_AZURE_OPENAI_DEPLOYMENT`
- `ACA_APP_AZURE_OPENAI_API_VERSION`

Required GitHub environment secrets when `secret_source=github-environment`:

- `ACA_APP_DATABASE_URL`
- `ACA_APP_ADMIN_TOKEN`

Optional GitHub environment secrets when `secret_source=github-environment`:

- `ACA_APP_OPENAI_API_KEY`
- `ACA_APP_AZURE_OPENAI_API_KEY`

Canonical GitHub environment:

- `aca-app`

The checked-in workflow expects those values to come from GitHub environment configuration, not from repo edits.

### 2a. Recommended secret source: Infisical over OIDC

The repo now supports Infisical as the recommended deploy-secret source.

When `secret_source=infisical`, the workflow fetches secrets at runtime using `Infisical/secrets-action` with GitHub OIDC and a machine identity.

Required GitHub environment vars for that path:

- `INFISICAL_IDENTITY_ID`
- `INFISICAL_PROJECT_SLUG`
- `INFISICAL_ENV_SLUG`

Optional:

- `INFISICAL_DOMAIN`
- `INFISICAL_SECRET_PATH`

Recommended secret names inside Infisical:

- `DATABASE_URL`
- `SIGNALFORGE_ADMIN_TOKEN`
- optional `OPENAI_API_KEY`
- optional `AZURE_OPENAI_API_KEY`

The workflow maps those into the checked-in deploy helper contract so the app and infra path do not need a separate runtime secret redesign.

Setup guide: [`infisical-secrets.md`](./infisical-secrets.md)

Use `secret_source=github-environment` only for short-lived debugging. The steady-state deploy contract is `aca-app` plus Infisical over OIDC.

### 3. The deploy workflow calls the checked-in shell helper

[`../scripts/deploy-aca-app.sh`](../scripts/deploy-aca-app.sh) is the local and CI-safe deploy entrypoint.

It wraps:

- [`../infra/aca/main.bicep`](../infra/aca/main.bicep)
- explicit required inputs
- derived revision suffixes for SHA-tag deploys
- `az deployment group what-if`
- `az deployment group create`

The script defaults to the app-role contract:

- `ca-signalforge`
- `surface=aca`
- `role=app`
- `DATABASE_DRIVER=postgres`
- public ingress on port `3000`

For custom domains, the deploy helper now behaves in two safe modes:

- if `ACA_APP_CUSTOM_DOMAINS_JSON` or `--custom-domains-json` is provided, that JSON array becomes the desired ingress-domain state
- if no domain JSON is provided and the app already exists, the helper preserves the current live `customDomains` block so a normal app deploy does not silently drop bound hostnames

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
  --resource-group <resource-group> \
  --environment-id /subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.App/managedEnvironments/<managed-environment-name> \
  --image ghcr.io/canepro/signalforge:<full-commit-sha> \
  --llm-provider azure \
  --azure-openai-endpoint https://<resource-name>.openai.azure.com/openai/v1/ \
  --azure-openai-deployment <deployment-name> \
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
8. Run the deeper migration steps from [`aca-cutover-runbook.md`](./aca-cutover-runbook.md) only if your operator instance still carries a legacy ACA app name.
