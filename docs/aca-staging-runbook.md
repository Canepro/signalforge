# ACA Staging Runbook

This runbook turns the Slice 1 image and Slice 2 ACA contract into a first staging deployment without changing production traffic.

This document still does **not** create Azure resources by itself. It defines the exact repo assets and commands an operator should use when they are ready to stand up staging.

## Preconditions

Before starting:

1. the Slice 1 app container image builds cleanly
2. the target ACA environment already exists
3. the target image is published to a registry ACA can pull from
4. the Neon staging or safe validation database URL is ready
5. the checked-in Postgres migrations have been applied to that database

Do not point staging at a shared app database such as the existing production-style `neondb`.
Use a dedicated staging database for the ACA app, for example `signalforge_staging`, so validation does not mix runs, sources, or collection jobs with another environment.

## Files to use

- template: [`../infra/aca/main.bicep`](../infra/aca/main.bicep)
- example parameters: [`../infra/aca/staging.parameters.example.json`](../infra/aca/staging.parameters.example.json)
- app/runtime contract: [`app-container-runtime.md`](./app-container-runtime.md)
- env contract: [`aca-env-contract.md`](./aca-env-contract.md)
- deployment contract: [`aca-app-deployment.md`](./aca-app-deployment.md)

## Recommended staging choices

- one staging ACA app for SignalForge web and API
- public ingress enabled
- `minReplicas=0`
- `maxReplicas=3`
- `DATABASE_DRIVER=postgres`
- Neon Postgres retained
- deterministic fallback allowed if no LLM keys are supplied

## Prepare the parameter file

Copy the example parameter file and fill in real values:

```bash
cp infra/aca/staging.parameters.example.json infra/aca/staging.parameters.json
```

Required values to replace:

- `containerAppsEnvironmentId`
- `image`
- `registryIdentityResourceId` if using the shared ACR pull identity
- `databaseUrl`
- `signalforgeAdminToken`

Optional values to replace:

- `registryServer`
- `llmProvider`
- `openAiApiKey`
- `openAiModel`
- `azureOpenAiEndpoint`
- `azureOpenAiApiKey`
- `azureOpenAiDeployment`
- `azureOpenAiApiVersion`
- `revisionSuffix`

## Validate the template locally

Compile the Bicep file before touching Azure:

```bash
az bicep build --file infra/aca/main.bicep
```

For the current Azure subscription inspected from this machine, the reusable ACR pull identity already exists at:

`/subscriptions/d3b51a0d-cdf1-445e-bac3-28e65892afbc/resourceGroups/rg-canepro-ph-dev-eus/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-canepro-ph-acrpull`

and has `AcrPull` on:

`/subscriptions/d3b51a0d-cdf1-445e-bac3-28e65892afbc/resourceGroups/rg-canepro-ph-dev-eus/providers/Microsoft.ContainerRegistry/registries/caneprophacr01`

If you want a non-destructive Azure-side validation later, use `what-if` before any create or update:

```bash
az deployment group what-if \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @infra/aca/staging.parameters.json
```

If you are driving the Windows Azure CLI from WSL on this machine, point the Azure temp directories at a Windows-accessible path first and pass the parameters file as a Windows path:

```bash
export TMP=/mnt/c/Users/i/AppData/Local/Temp/codex-aca
export TEMP=/mnt/c/Users/i/AppData/Local/Temp/codex-aca
export DOTNET_BUNDLE_EXTRACT_BASE_DIR=/mnt/c/Users/i/AppData/Local/Temp/codex-aca

mkdir -p "$TMP"

az deployment group what-if \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @"$(wslpath -w infra/aca/staging.parameters.json)"
```

## Deploy staging

When ready to create or update the staging app:

```bash
az deployment group create \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @infra/aca/staging.parameters.json
```

## Post-deploy verification

Run these checks against the staging ACA hostname:

1. `GET /api/health` returns `200`
2. dashboard loads
3. `GET /api/runs` responds
4. on a fresh staging database, `GET /api/runs` is empty before validation uploads
5. create or view a Source in `/sources` or `POST /api/sources`
6. enroll an agent
7. queue one host job
8. queue one Kubernetes job
9. verify both jobs can be claimed, started, and completed through `POST /api/collection-jobs/{id}/artifact`
10. verify the host job reaches `submitted` with `result_analysis_status=complete`
11. verify the Kubernetes job reaches `submitted` with `result_analysis_status=complete`

## Rollback stance

If the staging deploy is bad:

1. keep production unchanged
2. revert to the previous ACA revision
3. rotate the ACA `database-url` secret back to the last known-good staging database if the issue was isolated to staging DB selection
4. fix the template, parameters, or image and redeploy

## Notes

- The current `GET /api/health` endpoint is config-focused. It is suitable for ACA probes and initial rollout checks, but it does not prove every dependency path by itself.
- Keep secrets in the parameter file only long enough to pass them to Azure, and prefer secret injection through secure operator workflows in the real environment.
