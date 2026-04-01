# ACA Primary App Runbook

This runbook turns the checked-in ACA contract into the deploy or refresh path for the primary SignalForge ACA app.

The repo now has two real deploy entrypoints:

- GitHub Actions: `Deploy ACA App`
- local shell helper: [`../scripts/deploy-aca-app.sh`](../scripts/deploy-aca-app.sh)

Use the workflow by default.
Use the shell helper when you want the same checked-in deploy path from a local terminal.

## Naming note

This repo now treats `primary ACA app` as the canonical role name.

Some existing Azure resource names, image tags, parameter files, and historical notes still use `staging`, for example:

- `ca-signalforge-staging`
- `infra/aca/staging.parameters.example.json`
- `infra/aca/primary.parameters.example.json` is the target-state replacement file for the rename cutover
- image tags such as `staging-68fa777`
- the dedicated ACA app database currently named `signalforge_staging`

Keep those names when referring to existing artifacts. Do not treat the word `staging` in those identifiers as the canonical environment taxonomy.

The example parameter file keeps its legacy filename for continuity with deployed artifact history, but the role-defining values inside it should use the current primary-app vocabulary and release-specific placeholders.

## Preconditions

Before starting:

1. the app container image builds cleanly
2. the target ACA environment already exists
3. the target image is published to a registry ACA can pull from
4. the dedicated ACA app Postgres URL is ready
5. the checked-in Postgres migrations have been applied to that database

Do not point the primary ACA app at an unrelated shared app database.
Use the dedicated ACA app database currently named `signalforge_staging` unless and until that legacy database identifier is intentionally renamed.

## Files to use

- template: [`../infra/aca/main.bicep`](../infra/aca/main.bicep)
- target-state example parameters: [`../infra/aca/primary.parameters.example.json`](../infra/aca/primary.parameters.example.json)
- legacy current-app example parameters: [`../infra/aca/staging.parameters.example.json`](../infra/aca/staging.parameters.example.json)
- release and deploy contract: [`app-release-and-aca-deploy.md`](./app-release-and-aca-deploy.md)
- cutover runbook: [`aca-cutover-runbook.md`](./aca-cutover-runbook.md)
- app/runtime contract: [`app-container-runtime.md`](./app-container-runtime.md)
- env contract: [`aca-env-contract.md`](./aca-env-contract.md)
- deployment contract: [`aca-app-deployment.md`](./aca-app-deployment.md)

## Recommended primary-app choices

- one ACA app for SignalForge web and API
- public ingress enabled
- `minReplicas=0`
- `maxReplicas=3`
- `DATABASE_DRIVER=postgres`
- Neon Postgres retained
- deterministic fallback allowed if no LLM keys are supplied

## Prepare the parameter file

Copy the example parameter file and fill in real values:

```bash
cp infra/aca/primary.parameters.example.json infra/aca/primary.parameters.json
```

Required values to replace:

- `containerAppsEnvironmentId`
- `image`
- `databaseUrl`
- `signalforgeAdminToken`

Optional values to replace:

- `registryServer`
- `registryIdentityResourceId` if using the legacy shared ACR pull identity
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

For the current verified primary-app target, the preferred app image is public GHCR:

`ghcr.io/canepro/signalforge:<release-tag>`

That means `registryServer` and `registryIdentityResourceId` can stay empty for the normal primary deploy path.

The older shared ACR pull identity remains a legacy fallback only:

`/subscriptions/d3b51a0d-cdf1-445e-bac3-28e65892afbc/resourceGroups/rg-canepro-ph-dev-eus/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-canepro-ph-acrpull`

If you want a non-destructive Azure-side validation later, use `what-if` before any create or update:

```bash
az deployment group what-if \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @infra/aca/primary.parameters.json
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
  --parameters @"$(wslpath -w infra/aca/primary.parameters.json)"
```

## Deploy the primary ACA app

### Preferred path: GitHub Actions

1. publish the target image through `Publish App Image`
2. run `Deploy ACA App`
3. start with `what_if=true`
4. rerun with `what_if=false` once the Azure plan looks correct

### Local fallback: checked-in shell helper

When you need the same deploy path from a terminal:

```bash
ACA_DATABASE_URL='postgres://<user>:<password>@<neon-host>/<database>?sslmode=require' \
ACA_ADMIN_TOKEN='<long-random-secret>' \
bash scripts/deploy-aca-app.sh \
  --resource-group <resource-group> \
  --environment-id <aca-environment-id> \
  --image ghcr.io/canepro/signalforge:<release-tag> \
  --what-if
```

Then rerun without `--what-if` for the real deploy.

If you need to mirror the current Azure OpenAI live shape, add:

```bash
ACA_AZURE_OPENAI_API_KEY='<azure-openai-key>' \
bash scripts/deploy-aca-app.sh \
  --resource-group <resource-group> \
  --environment-id <aca-environment-id> \
  --image ghcr.io/canepro/signalforge:<release-tag> \
  --llm-provider azure \
  --azure-openai-endpoint https://Signalforge-resource.openai.azure.com/openai/v1/ \
  --azure-openai-deployment gpt-5.4-mini \
  --what-if
```

### Direct Azure CLI fallback

When you explicitly want to bypass the helper and call Azure yourself:

```bash
az deployment group create \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @infra/aca/primary.parameters.json
```

## Post-deploy verification

Run these checks against the primary ACA app hostname:

1. `GET /api/health` returns `200`
2. dashboard loads
3. `GET /api/runs` responds
4. `bash scripts/check-aca-app.sh https://<aca-fqdn>` succeeds
5. on a fresh ACA app database, `GET /api/runs` is empty before new uploads
6. create or view a Source in `/sources` or `POST /api/sources`
7. enroll an agent
8. queue one host job
9. queue one Kubernetes job
10. verify both jobs can be claimed, started, and completed through `POST /api/collection-jobs/{id}/artifact`
11. verify the host job reaches `submitted` with `result_analysis_status=complete`
12. verify the Kubernetes job reaches `submitted` with `result_analysis_status=complete`

## Rollback stance

If the ACA deploy is bad:

1. keep traffic on the previous known-good ACA revision
2. reactivate the previous revision if a new one was promoted
3. rotate the ACA `database-url` secret back only if the issue was isolated to DB selection
4. fix the template, parameters, or image and redeploy

## Notes

- The current `GET /api/health` endpoint is config-focused. It is suitable for ACA probes and initial rollout checks, but it does not prove every dependency path by itself.
- Keep secrets in the parameter file only long enough to pass them to Azure, and prefer secret injection through secure operator workflows in the real environment.
- If the primary ACA app database already contains older agent-submitted runs from before `collected_at` inference shipped, repair them in place with `DATABASE_DRIVER=postgres DATABASE_URL=<database-url> bun run db:backfill:collected-at`.
