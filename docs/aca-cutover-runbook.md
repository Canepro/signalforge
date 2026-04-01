# ACA Cutover Runbook

Use this guide only if your operator instance still carries a legacy ACA app name and you need to move to the durable app name:

- from `<legacy-app-name>`
- to `ca-signalforge`

The reference instance has already completed this migration.
This document keeps the additive migration pattern available for other operators without treating one older resource name as product taxonomy.

## Preconditions

Before cutover:

1. `Publish App Image` has published the target image to `ghcr.io/canepro/signalforge`
2. the GHCR package is public
3. a GitHub deploy environment is configured for the ACA app workflow
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

## Step 2: run the app deployment as a dry run

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
  --resource-group <resource-group> \
  --environment-id /subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.App/managedEnvironments/<managed-environment-name> \
  --app-name ca-signalforge \
  --image ghcr.io/canepro/signalforge:<full-commit-sha> \
  --llm-provider azure \
  --azure-openai-endpoint https://<resource-name>.openai.azure.com/openai/v1/ \
  --azure-openai-deployment <deployment-name> \
  --what-if
```

Do not continue until the dry-run output matches the expected additive create.

## Step 3: create `ca-signalforge` in parallel

Run the same deploy again with `what_if=false`.

That creates the new app in parallel while leaving `<legacy-app-name>` untouched.

The intended steady state for the new app is:

- app name: `ca-signalforge`
- image: `ghcr.io/canepro/signalforge:<full-commit-sha>`
- tags: `app=signalforge`, `surface=aca`, `role=app`
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

Change one low-risk agent from the legacy app origin to the new `ca-signalforge` origin.

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

Do not delete the legacy app immediately.

Keep it until all of these are true:

- the new app has handled real traffic
- the new app has survived at least one subsequent deploy refresh
- rollback pressure is low enough that the old hostname is no longer needed

## Step 8: decommission the legacy app

Only after the soak period:

1. confirm no agents or scripts still point at the legacy hostname
2. confirm the new app is the only canonical operator URL
3. disable or delete the legacy ACA app
4. remove old registry or identity wiring that is no longer used anywhere

This final step is intentionally not automated in this repo because it is destructive.

## Rollback

If `ca-signalforge` is unhealthy:

1. leave the legacy app running
2. point agents back to the legacy hostname
3. keep the shared database unchanged
4. fix the new app and retry the additive cutover
