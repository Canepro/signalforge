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
- `databaseUrl`
- `signalforgeAdminToken`

Optional values to replace:

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

If you want a non-destructive Azure-side validation later, use `what-if` before any create or update:

```bash
az deployment group what-if \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @infra/aca/staging.parameters.json
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
4. create or view a Source in `/sources`
5. enroll an agent
6. queue one host job
7. queue one Kubernetes job
8. verify artifact upload succeeds and a run is created

## Rollback stance

If the staging deploy is bad:

1. keep production unchanged
2. revert to the previous ACA revision
3. do not rotate away from Neon during rollback
4. fix the template, parameters, or image and redeploy

## Notes

- The current `GET /api/health` endpoint is config-focused. It is suitable for ACA probes and initial rollout checks, but it does not prove every dependency path by itself.
- Keep secrets in the parameter file only long enough to pass them to Azure, and prefer secret injection through secure operator workflows in the real environment.
