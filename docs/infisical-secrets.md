# Infisical Secrets For SignalForge

This document describes the repo-supported Infisical setup for SignalForge.

The intended split is:

- Infisical is the source of truth for deploy and local-development secrets
- GitHub Actions authenticates to Infisical with OIDC at runtime
- Azure Container Apps remains the runtime secret boundary for the deployed app

That keeps GitHub free of long-lived deploy secrets while avoiding a runtime redesign inside the app.

## Current repo contract

The checked-in ACA deploy workflow now supports two secret sources:

- `infisical` as the recommended path
- `github-environment` as the compatibility fallback

Workflow:

1. GitHub Actions authenticates to Infisical using `Infisical/secrets-action`
2. the workflow fetches secrets for one Infisical project and environment
3. the workflow maps those secrets into the existing ACA deploy helper contract
4. the helper writes them into ACA secrets and deploys or updates the app

The deploy workflow now forces JavaScript actions onto Node 24 so the Infisical action path is validated ahead of the hosted-runner Node 20 removal window.

The app still reads normal ACA environment variables such as `DATABASE_URL` and `SIGNALFORGE_ADMIN_TOKEN`.

## GitHub Actions setup

The deploy workflow needs these GitHub environment variables when `secret_source=infisical`:

- `INFISICAL_IDENTITY_ID`
- `INFISICAL_PROJECT_SLUG`
- `INFISICAL_ENV_SLUG`

Optional:

- `INFISICAL_DOMAIN`
- `INFISICAL_SECRET_PATH`

Recommended defaults:

- `INFISICAL_DOMAIN=https://app.infisical.com`
- `INFISICAL_SECRET_PATH=/`

The deploy workflow still needs the non-secret ACA and Azure variables already documented in [`app-release-and-aca-deploy.md`](./app-release-and-aca-deploy.md), such as:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `ACA_APP_RESOURCE_GROUP`
- `ACA_APP_ENVIRONMENT_ID`

## Infisical machine identity setup

Use an Infisical machine identity with OIDC authentication for GitHub Actions.

Recommended subject shape:

- `repo:Canepro/signalforge:environment:aca-app`

Recommended audience:

- `https://github.com/Canepro`

Use stricter hardcoded subject and audience values when possible instead of broad wildcards.

## Recommended secret names in Infisical

Store app-runtime names in Infisical rather than GitHub-specific names:

- `DATABASE_URL`
- `SIGNALFORGE_ADMIN_TOKEN`
- optional `OPENAI_API_KEY`
- optional `AZURE_OPENAI_API_KEY`

The workflow maps those names to the deploy helper inputs:

- `ACA_DATABASE_URL`
- `ACA_ADMIN_TOKEN`
- `ACA_OPENAI_API_KEY`
- `ACA_AZURE_OPENAI_API_KEY`

That keeps the Infisical project aligned with the app runtime contract instead of a specific CI implementation.

## Deploy workflow usage

After the GitHub environment variables and Infisical machine identity are in place:

1. run `Deploy ACA App`
2. leave `secret_source=infisical`
3. choose `aca-app` as the GitHub environment
4. start with `what_if=true`

Use `secret_source=github-environment` only for short-lived debugging.

## Local development

For local development, the clean path is the Infisical CLI:

```bash
infisical init
infisical run -- bun run dev
```

Useful variations:

```bash
infisical run -- bun run typecheck
infisical run -- bash scripts/run-postgres-parity-local.sh
```

The repo does not require Infisical for local development, but this is the preferred path once your project is wired up.
