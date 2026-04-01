# Phase 10b: ACA Resource Rename Cutover

## Problem

The live Azure Container App resource is currently named `ca-signalforge-staging`.

That name was survivable during the early rollout, but it is now wrong in a durable way:

- ACA is the primary app-hosting path
- Vercel is the preview/review path
- `staging` is no longer the right role label

Because ACA resource names are identities, this is not an in-place rename. It is a controlled cutover from one app resource to another.

## Goal

Replace the live ACA app identity:

- from `ca-signalforge-staging`
- to `ca-signalforge`

without changing the product contract, database posture, or agent API shape.

## Non-goals

- database rename in the same cut
- auth redesign
- collector or agent protocol changes
- Front Door / custom domain work in the same cut
- multi-region or HA redesign

## Current verified state

As of April 1, 2026:

- live ACA app: `ca-signalforge-staging`
- live revision: `ca-signalforge-staging--stg68fa777`
- live image: `caneprophacr01.azurecr.io/signalforge:staging-68fa777`
- ingress: public
- target port: `3000`
- min replicas: `0`
- database driver: `postgres`
- app backend: dedicated ACA app database currently named `signalforge_staging`

## Naming decisions

Canonical names:

- ACA app resource: `ca-signalforge`
- ACA role language in docs: `primary ACA app`
- public image: `ghcr.io/canepro/signalforge`

Legacy names to tolerate temporarily:

- ACA app resource: `ca-signalforge-staging`
- database name: `signalforge_staging`
- old image tags such as `staging-68fa777`

## Constraints

- the cutover should be additive first, destructive later
- the database should stay the same for the first rename cut
- rollback must be a matter of repointing agents and keeping the old app alive
- agent URLs must move explicitly; they will not discover the new app automatically

## Plan

### Step 1: Prepare target-state infra files

Add or confirm:

- `infra/aca/primary.parameters.example.json`
- `containerAppName = ca-signalforge`
- public GHCR image reference
- primary-role tags such as `environment=primary`, `slice=aca-primary`

Do not delete the legacy `staging.parameters.example.json` yet.

### Step 2: Build one release image that both apps can run

Use one identical app image for comparison across old and new ACA apps.

That image should become available at:

- `ghcr.io/canepro/signalforge:<release-tag>`

Keep the old ACA app on its current image until the new app is ready to validate.

### Step 3: Create the new ACA app in parallel

Create `ca-signalforge` as a second app in the same ACA environment with:

- same app image
- same health probes
- same secrets
- same Neon/Postgres backend
- same operator API token behavior
- same public ingress posture

This is the key risk-reduction move: parallel create, not replace-in-place.

### Step 4: Validate the new app before any agent cutover

Minimum checks:

1. `GET /api/health`
2. `GET /api/runs`
3. dashboard load
4. Sources UI access
5. one direct upload
6. one host collection job
7. one Kubernetes collection job

The old app stays live during this step.

### Step 5: Move clients and agents

Change all explicit consumers from the old ACA hostname to the new one:

- agent `SIGNALFORGE_URL`
- any shell scripts or local env files
- any bookmarks or runbooks that treat the old app as canonical

Prefer a controlled small-batch move:

1. move one agent
2. verify
3. move the rest

### Step 6: Hold the old app as rollback target

Do not delete `ca-signalforge-staging` immediately.

Keep it available as the rollback target until the new app has:

- survived at least one full deployment refresh
- handled real job traffic across all current artifact families
- proven stable for enough time that rollback pressure is low

### Step 7: Decommission the legacy app

Only after the new app has settled:

- disable or delete `ca-signalforge-staging`
- remove old app-specific secrets if no longer needed
- update docs to stop presenting the old app as an active resource

## Rollback

If the new app is unhealthy:

1. leave `ca-signalforge-staging` untouched
2. move agents back to the old ACA hostname
3. keep the shared database unchanged unless the issue is DB-specific
4. fix the new app and retry

## Verification checklist

- both apps can boot from the same image
- `ca-signalforge` responds correctly before agent migration
- host jobs complete through the new app
- Kubernetes jobs complete through the new app
- run detail, compare, Sources, and operator APIs remain unchanged
- no client still depends on the old hostname before final decommission

## Out of scope follow-ons

- rename `signalforge_staging` database
- custom domain for the new ACA app
- switching min replicas from `0` to `1`
- replacing manual deploys with a repo-owned release workflow

That last item is tracked separately in `phase-10c-public-image-and-release-pipeline.md`.
