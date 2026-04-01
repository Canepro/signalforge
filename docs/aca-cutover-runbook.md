# ACA Cutover Runbook

This runbook is the exact operator path for replacing the legacy ACA resource name:

- from `ca-signalforge-staging`
- to `ca-signalforge`

without changing the product contract, database posture, or agent API shape.

## Verified starting state

Verified on April 1, 2026 with `az` read-only commands from this machine:

- subscription: `d3b51a0d-cdf1-445e-bac3-28e65892afbc`
- resource group: `rg-canepro-ph-dev-eus`
- ACA environment: `cae-canepro-ph-dev-eus`
- live app: `ca-signalforge-staging`
- live hostname: `https://ca-signalforge-staging.kinddune-53ac219d.eastus2.azurecontainerapps.io`
- live revision: `ca-signalforge-staging--stg68fa777`
- live image: `caneprophacr01.azurecr.io/signalforge:staging-68fa777`
- live ingress: public
- live target port: `3000`
- live replicas policy: `minReplicas=0`, `maxReplicas=3`
- there is no live `ca-signalforge` app yet

## Preconditions

Before cutover:

1. `Publish App Image` has published the target image to `ghcr.io/canepro/signalforge`
2. the GHCR package is public
3. the `aca-primary` GitHub environment is configured
4. the deploy workflow can complete a `what-if`
5. the legacy app remains untouched and healthy

## Step 1: publish the target release image

Use the repo-owned publish workflow:

1. merge the desired commit to `main`
2. wait for `CI` to pass
3. wait for `Publish App Image` to publish the image
4. copy the immutable full SHA tag

Preferred deploy tag shape:

- `ghcr.io/canepro/signalforge:<full-commit-sha>`

## Step 2: run the primary-app deployment as a dry run

Run `Deploy ACA App` with:

- `image_tag=<full-commit-sha>`
- `container_app_name=ca-signalforge`
- `what_if=true`

Or run the shell helper locally:

```bash
ACA_DATABASE_URL='postgres://<user>:<password>@<host>/<db>?sslmode=require' \
ACA_ADMIN_TOKEN='<long-random-secret>' \
ACA_AZURE_OPENAI_API_KEY='<azure-openai-key>' \
bash scripts/deploy-aca-app.sh \
  --resource-group rg-canepro-ph-dev-eus \
  --environment-id /subscriptions/d3b51a0d-cdf1-445e-bac3-28e65892afbc/resourceGroups/rg-canepro-ph-dev-eus/providers/Microsoft.App/managedEnvironments/cae-canepro-ph-dev-eus \
  --app-name ca-signalforge \
  --image ghcr.io/canepro/signalforge:<full-commit-sha> \
  --llm-provider azure \
  --azure-openai-endpoint https://Signalforge-resource.openai.azure.com/openai/v1/ \
  --azure-openai-deployment gpt-5.4-mini \
  --what-if
```

Do not continue until the dry-run output matches the expected additive create.

## Step 3: create `ca-signalforge` in parallel

Run the same deploy again with `what_if=false`.

That creates the new app in parallel while leaving `ca-signalforge-staging` untouched.

The intended steady state for the new app is:

- app name: `ca-signalforge`
- image: `ghcr.io/canepro/signalforge:<full-commit-sha>`
- tags: `app=signalforge`, `environment=primary`, `slice=aca-primary`
- same ACA environment
- same Postgres backend
- same operator token behavior
- same public ingress posture

## Step 4: validate the new app before moving agents

Use the smoke script against the new hostname:

```bash
SIGNALFORGE_ADMIN_TOKEN='<long-random-secret>' \
bash scripts/check-aca-app.sh https://ca-signalforge.<aca-default-domain>
```

Then run the deeper product checks:

1. load the dashboard
2. open `/sources`
3. confirm existing Sources render correctly
4. submit one direct upload
5. queue one host collection job
6. queue one Kubernetes collection job
7. verify both jobs reach `submitted`
8. verify linked runs complete analysis successfully

## Step 5: move one agent first

Change one low-risk agent from:

- `SIGNALFORGE_URL=https://ca-signalforge-staging...`

to:

- `SIGNALFORGE_URL=https://ca-signalforge...`

Then verify:

- heartbeat succeeds
- `GET /api/agent/jobs/next` still gates correctly
- claim, start, and artifact upload still succeed

## Step 6: move the rest of the agents

After the first moved agent is healthy:

1. move the remaining host agents
2. move the cluster-side agents
3. update any local scripts, bookmarks, and runbooks that still treat the old hostname as canonical

## Step 7: hold the old app as rollback target

Do not delete `ca-signalforge-staging` immediately.

Keep it until all of these are true:

- the new app has handled real traffic
- the new app has survived at least one subsequent deploy refresh
- rollback pressure is low enough that the old hostname is no longer needed

## Step 8: decommission the legacy app

Only after the soak period:

1. confirm no agents or scripts still point at `ca-signalforge-staging`
2. confirm the new app is the only canonical operator URL
3. disable or delete `ca-signalforge-staging`
4. remove legacy ACR-specific app config if it is no longer used anywhere

This final step is intentionally not automated in this repo because it is destructive.

## Rollback

If `ca-signalforge` is unhealthy:

1. leave `ca-signalforge-staging` running
2. point agents back to the legacy hostname
3. keep the shared database unchanged
4. fix the new app and retry the additive cutover
