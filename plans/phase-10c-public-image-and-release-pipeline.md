# Phase 10c: Public Image and Release Pipeline

## Problem

The current ACA app shipping flow is not repo-owned or durable enough.

Current observed state:

- images are being built and pushed manually
- the app image currently lives in a personal ACR path
- historical tags use rollout-shaped names such as `staging-68fa777`
- there is no GitHub Actions workflow in this repo that publishes the app image

That is awkward for an open-source project:

- the image is not obviously public and reusable
- the shipping path depends on personal deployment muscle memory
- release behavior is not encoded as repo automation

## Goal

Create a durable release model where:

- the app image is publicly pullable
- the canonical app image lives under `ghcr.io/canepro/signalforge`
- GitHub Actions builds and publishes the image
- ACA can pull the image without depending on a personal ACR identity

## Non-goals

- full GitOps for ACA in the same slice
- automatic production cutover on every merge
- custom domain or CDN setup
- multi-arch expansion unless the app actually needs it

## Current verified state

- `Dockerfile` exists and the app is already containerized
- `infra/aca/main.bicep` allows registry auth to be omitted entirely
- current ACA shipping history shows manual pushes to `caneprophacr01.azurecr.io/signalforge:*`
- current CI only runs checks and Postgres parity; it does not publish images

## Decision

### Canonical public image

Use:

- `ghcr.io/canepro/signalforge`

Why:

- it matches the open-source project identity
- it is easy for users to pull
- it removes the need to present a personal ACR as the public distribution path
- it keeps the project image tied to GitHub, where the source of truth already lives

### Tagging model

Publish at least:

- immutable commit SHA tags
- `main` for the latest default-branch image
- optional version tags later if formal releases are introduced

Recommended examples:

- `ghcr.io/canepro/signalforge:68fa777`
- `ghcr.io/canepro/signalforge:main`

Do not keep shipping new app releases under `staging-*` tags.

## Plan

### Step 1: Normalize the image contract

Docs and infra should treat this as the target image:

- `ghcr.io/canepro/signalforge:<release-tag>`

ACA examples should no longer imply that a personal ACR path is the canonical public image.

### Step 2: Add a publish workflow

Add a GitHub Actions workflow dedicated to image publication.

Minimum behavior:

1. trigger on push to `main`
2. optionally trigger on tags later
3. build the Docker image from the repo `Dockerfile`
4. push to GHCR
5. publish at least `sha` and `main` tags

Keep this separate from the test-only CI workflow so shipping stays explicit.

### Step 3: Keep release and deploy as separate concerns

Do not automatically redeploy ACA on every successful image push in the first slice.

Safer first structure:

- workflow A: test
- workflow B: publish image
- operator step or separate workflow C: deploy ACA using a chosen published tag

That preserves rollback clarity.

### Step 4: Make ACA pull the public image

For public GHCR pulls:

- set `image = ghcr.io/canepro/signalforge:<release-tag>`
- leave `registryServer` empty
- leave `registryIdentityResourceId` empty

The current Bicep already supports this because `registries` becomes an empty list when those values are unset.

### Step 5: Add an explicit ACA deploy workflow or script

After public image publication is stable, add one repo-owned deploy path:

Option A:

- `scripts/deploy-aca-app.sh`

Option B:

- a manual-dispatch GitHub Actions workflow that runs the ACA deployment using a provided image tag

The first deploy automation should require an explicit chosen tag, not “deploy latest”.

### Step 6: Retire ACR as the canonical public app-image path

After GHCR shipping is stable:

- stop documenting the personal ACR app image as canonical
- keep ACR only if there is a separate personal operational need
- otherwise remove the app’s dependency on ACR entirely

## Verification

The slice is complete when:

1. `docker build` from the repo succeeds in CI
2. `ghcr.io/canepro/signalforge:main` is publicly pullable
3. `ghcr.io/canepro/signalforge:<sha>` is publicly pullable
4. ACA can run from the GHCR image without registry identity configuration
5. the release path is documented in-repo instead of living only in chat or memory

## Risks

### Risk: accidental deploy coupling

If image publication also auto-deploys ACA too early, rollback gets worse.

Mitigation:

- keep publish and deploy separate initially

### Risk: tag ambiguity

If mutable tags become the only reference, operators may deploy the wrong image.

Mitigation:

- use immutable SHA tags for actual deploys
- keep `main` as convenience only

### Risk: docs drift between image path and infra

If GHCR becomes canonical but ACA examples still teach ACR, the repo will drift again.

Mitigation:

- update docs and parameter examples in the same slice

## Out of scope follow-ons

- signed attestations / SBOM
- multi-platform app images
- semantic version release process
- full GitOps promotion flow

Those are good later improvements, but they should not block the first public-image release path.
