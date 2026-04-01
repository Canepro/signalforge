# ACA App Runbook

This runbook turns the checked-in ACA contract into the deploy or refresh path for the SignalForge ACA app.

The repo now has two real deploy entrypoints:

- GitHub Actions: `Deploy ACA App`
- local shell helper: [`../scripts/deploy-aca-app.sh`](../scripts/deploy-aca-app.sh)

Use the workflow by default.
Use the shell helper when you want the same checked-in deploy path from a local terminal.

## Naming note

Use `ca-signalforge` as the durable app name for new operator instances.
If your own Azure estate still carries an older legacy app name, treat that as migration history rather than product taxonomy and use [`aca-cutover-runbook.md`](./aca-cutover-runbook.md) to leave it behind.

## Preconditions

Before starting:

1. the app container image builds cleanly
2. the target ACA environment already exists
3. the target image is published to a registry ACA can pull from
4. the dedicated ACA app Postgres URL is ready
5. the checked-in Postgres migrations have been applied to that database

Do not point the ACA app at an unrelated shared app database.

## Files to use

- template: [`../infra/aca/main.bicep`](../infra/aca/main.bicep)
- target-state example parameters: [`../infra/aca/app.parameters.example.json`](../infra/aca/app.parameters.example.json)
- legacy-name migration example parameters: [`../infra/aca/staging.parameters.example.json`](../infra/aca/staging.parameters.example.json)
- release and deploy contract: [`app-release-and-aca-deploy.md`](./app-release-and-aca-deploy.md)
- legacy-name migration guide: [`aca-cutover-runbook.md`](./aca-cutover-runbook.md)
- app/runtime contract: [`app-container-runtime.md`](./app-container-runtime.md)
- env contract: [`aca-env-contract.md`](./aca-env-contract.md)
- deployment contract: [`aca-app-deployment.md`](./aca-app-deployment.md)

## Recommended app choices

- one ACA app for SignalForge web and API
- public ingress enabled
- `minReplicas=0`
- `maxReplicas=3`
- `DATABASE_DRIVER=postgres`
- Postgres retained as the durable app backend
- deterministic fallback allowed if no LLM keys are supplied

## Prepare the parameter file

Copy the example parameter file and fill in real values:

```bash
cp infra/aca/app.parameters.example.json infra/aca/app.parameters.json
```

Required values to replace:

- `containerAppsEnvironmentId`
- `image`
- `databaseUrl`
- `signalforgeAdminToken`

Optional values to replace:

- `registryServer`
- `registryIdentityResourceId`
- `customDomains`
- `llmProvider`
- `openAiApiKey`
- `openAiModel`
- `azureOpenAiEndpoint`
- `azureOpenAiApiKey`
- `azureOpenAiDeployment`
- `azureOpenAiApiVersion`
- `revisionSuffix`

For the normal app path, the preferred image is public GHCR:

- `ghcr.io/canepro/signalforge:<release-tag>`

That means `registryServer` and `registryIdentityResourceId` can stay empty unless your operator instance intentionally uses a private registry pull path.

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
  --parameters @infra/aca/app.parameters.json
```

## Deploy the ACA app

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

If the app already exists and has custom domains bound in ACA, the helper preserves those live bindings automatically unless you pass `--custom-domains-json` to replace them explicitly.

If you need Azure OpenAI:

```bash
ACA_AZURE_OPENAI_API_KEY='<azure-openai-key>' \
bash scripts/deploy-aca-app.sh \
  --resource-group <resource-group> \
  --environment-id <aca-environment-id> \
  --image ghcr.io/canepro/signalforge:<release-tag> \
  --llm-provider azure \
  --azure-openai-endpoint https://<resource-name>.openai.azure.com/openai/v1/ \
  --azure-openai-deployment <deployment-name> \
  --what-if
```

### Direct Azure CLI fallback

When you explicitly want to bypass the helper and call Azure yourself:

```bash
az deployment group create \
  --resource-group <resource-group> \
  --template-file infra/aca/main.bicep \
  --parameters @infra/aca/app.parameters.json
```

## Post-deploy verification

Run these checks against the ACA app hostname:

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

## Optional public custom domain

If the operator wants a stable public hostname, bind it directly to the ACA app after the default ACA hostname is healthy.

For a subdomain such as `signalforge.example.com`:

1. create a `CNAME` from the chosen hostname to the ACA default hostname
2. create the matching `TXT` verification record using the ACA custom-domain verification id
3. add the hostname under `Custom domains` on the ACA app
4. prefer an ACA-managed certificate for the first binding
5. keep Cloudflare or other DNS providers in `DNS only` mode until validation and certificate issuance succeed

If the operator wants the hostname binding under checked-in deploy control rather than portal-only state, set `ACA_APP_CUSTOM_DOMAINS_JSON` in the GitHub deploy environment or pass `--custom-domains-json` to the helper. Use the ACA ingress shape directly, for example:

```json
[
  {
    "name": "signalforge.example.com",
    "bindingType": "SniEnabled",
    "certificateId": "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.App/managedEnvironments/<managed-environment>/managedCertificates/<certificate-name>"
  }
]
```

Without that explicit JSON, the checked-in helper preserves the current live bindings on update so a normal app deploy does not remove a working hostname.

Reference deployment:

- public app URL: `https://signalforge.canepro.me`
- ACA default hostname: `https://ca-signalforge.kinddune-53ac219d.eastus2.azurecontainerapps.io`

Do not point the GitHub repository homepage or operator bookmarks at a preview URL once the custom ACA domain is live.

## Rollback stance

If the ACA deploy is bad:

1. keep traffic on the previous known-good ACA revision
2. reactivate the previous revision if a new one was promoted
3. rotate the ACA `database-url` secret back only if the issue was isolated to DB selection
4. fix the template, parameters, or image and redeploy

## Notes

- The current `GET /api/health` endpoint is config-focused. It is suitable for ACA probes and initial rollout checks, but it does not prove every dependency path by itself.
- Keep secrets in the parameter file only long enough to pass them to Azure, and prefer secret injection through secure operator workflows in the real environment.
- If the ACA app database already contains older agent-submitted runs from before `collected_at` inference shipped, repair them in place with `DATABASE_DRIVER=postgres DATABASE_URL=<database-url> bun run db:backfill:collected-at`.
