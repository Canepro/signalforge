# Phase 10: Azure Container Apps Migration

## Why This Exists

Historical note:

- this file started as the migration plan from Vercel to ACA
- current repo reality is stronger: ACA is now the app-hosting path and Vercel remains the preview/review surface
- keep the migration wording below as historical planning context unless a section explicitly states the current operating role

SignalForge now has a real execution-plane story:

- host `systemd` services for `linux-audit-log`
- cluster-side deployments for `kubernetes-bundle`
- long-running agent polling and artifact upload

That operator model no longer fits the current production deployment boundary.

At the start of Phase 10, the live deployment path ran on Vercel with Neon Postgres. That was fine for UI, API, and preview work, but it became a real product limitation for agent-driven artifact ingestion because Vercel Functions enforce a small request-body limit. Real `linux-audit-log` artifacts can exceed that ceiling, and larger `kubernetes-bundle` artifacts can do the same.

This phase exists to migrate SignalForge production from Vercel to Azure Container Apps (ACA) so the control plane can support the product we actually built.

## Decision

### Recommended target

Migrate the **SignalForge app** to **Azure Container Apps**.

### Recommended database stance

Keep **Neon Postgres** for the first migration slice.

Do **not** combine:

- app-hosting migration
- database migration
- collector/agent protocol changes

in one step.

The current urgent problem is artifact-ingestion hosting, not the database.

### Why ACA over Cloudflare Workers

ACA is the better near-term operational fit because:

- SignalForge is already a Next.js + Node-style app
- the app needs normal multipart upload handling for agent artifacts
- the app already assumes a traditional server-style runtime more than an edge-isolate runtime
- ACA scales to zero while still running the app as a real container
- ACA is a smaller architectural jump than redesigning ingestion around Workers constraints

Cloudflare remains a possible later option, but it should not be the first migration target.

## Goals

- remove the current agent-ingestion blocker caused by Vercel request-body limits
- preserve the existing app, API, and agent contract with minimal behavior change
- keep Vercel previews available if they remain useful for PR review
- avoid unnecessary database migration during the first hosting move
- define a production deployment shape that is credible for always-on host and cluster agents

## Non-Goals

- rewriting SignalForge around Workers or edge-only runtime patterns
- changing the agent contract
- redesigning collectors to stay under Vercel upload ceilings
- moving off Neon in the same phase unless cost or platform constraints force it
- introducing auth, tenancy, or scheduler work

## Phase-10 Starting State

Starting point for this migration plan:

- app hosting: Vercel
- database: Neon Postgres
- API shape: Next.js App Router routes
- local dev: SQLite by default, Postgres supported
- agents: external `signalforge-agent`
- collectors: external `signalforge-collectors`

Known production mismatch:

- host audit artifacts can exceed the current hosted upload ceiling
- Kubernetes artifacts can also exceed that ceiling as clusters grow
- agent and collector behavior is correct; the ingress boundary is the problem

## Target State

Production target after migration:

- app hosting: Azure Container Apps
- database: Neon Postgres initially
- ingress: ACA public HTTPS endpoint
- app runtime: containerized SignalForge app
- agents: point `SIGNALFORGE_URL` at ACA instead of Vercel
- previews: Vercel may remain for non-agent preview review if still useful

## Constraints

- the app must continue to support `DATABASE_DRIVER=postgres`
- the migration should not break SQLite local development
- the sql.js wasm path still needs to work in container builds
- the new deployment must preserve route behavior and API compatibility
- the migration should keep rollback simple

## Implementation Plan

## Start Here Tomorrow

Use this as the first-session handoff instead of rebuilding context from chat.

### First objective

Finish **Slice 1: App Containerization** before touching Azure resources.

Do not start with:

- ACA portal setup
- DNS
- Azure PostgreSQL migration
- agent URL cutover

### Tomorrow's sequence

1. Inspect the current runtime contract:
   - `README.md`
   - `docs/getting-started.md`
   - `plans/current-plan.md`
   - `src/app`
   - `src/lib/db`
   - `src/lib/storage`
2. Add container build assets:
   - `Dockerfile`
   - `.dockerignore`
3. Lock the runtime env contract for container hosting:
   - required server env vars
   - optional provider env vars
   - Postgres-only production path
4. Build the image locally.
5. Run the container locally against the current Postgres target or a safe local equivalent.
6. Verify:
   - app boots
   - dashboard loads
   - one API route responds
   - `sql.js` asset behavior is not broken by the image

### Concrete acceptance gate for tomorrow

Do not move on to ACA deployment work until all of these are true:

- container image builds locally
- app starts successfully from the built image
- required env vars are documented, not inferred from chat history
- the repo has a committed containerization slice or a clearly reviewable branch checkpoint

### Likely files involved first

- `package.json`
- `bun.lock` only if dependency behavior forces it
- `next.config.*` if runtime packaging needs adjustment
- `src/lib/db/*`
- `src/lib/storage/*`
- `README.md`
- `docs/README.md`

### Known watchouts

- do not accidentally optimize the container for SQLite-only local behavior
- do not break the current Postgres production path while preserving local SQLite dev
- watch `sql.js` wasm/static asset resolution carefully in the built image
- keep the first slice small enough that rollback is just reverting container-build assets

### Slice 1: App Containerization

Add a production container build for SignalForge itself.

Required outputs:

- app `Dockerfile`
- `.dockerignore`
- explicit runtime env contract for container deployment

Container requirements:

- production Next.js build
- Bun runtime if kept consistent with the repo, unless Node is clearly simpler for the built app
- environment support for:
  - `DATABASE_DRIVER=postgres`
  - `DATABASE_URL`
  - `SIGNALFORGE_ADMIN_TOKEN`
  - LLM provider env vars
- sql.js wasm asset resolution must still work in the built image for any code paths that touch SQLite locally or in dev-style environments

Acceptance criteria:

- image builds locally
- app starts from the container
- health-checkable HTTP endpoint comes up

### Slice 2: ACA Deployment Contract

Define the Azure deployment contract in-repo.

Required outputs:

- ACA environment variable contract
- ACA deployment doc
- ACA app shape decision:
  - one app for SignalForge web + API
- ingress and secret model

Decisions to lock:

- public ingress vs private ingress plus front door later
- secret storage via ACA secrets
- persistent environment variables and revisions strategy
- min replicas:
  - `0` if cold-start tolerance is acceptable
  - `1` if agent responsiveness matters more than zero-idle cost

Acceptance criteria:

- all required app secrets and env vars are documented
- operator can deploy a first ACA instance without guessing missing config

### Slice 3: Staging ACA Deployment

Stand up a staging ACA environment before any production cutover.

Required outputs:

- staging ACA app
- staging URL
- staging secret/env configuration
- app connected to Neon Postgres

Validation:

- open dashboard successfully
- create Source
- enroll agent
- queue host job
- queue Kubernetes job
- verify artifact upload and resulting run creation

Acceptance criteria:

- at least one host artifact larger than the old Vercel ceiling uploads successfully
- at least one real Kubernetes job reaches `submitted` and `result_analysis_status=complete`

### Slice 4: Agent Cutover Plan

Move agent traffic from Vercel to ACA in a controlled way.

Recommended order:

1. one non-critical host agent
2. one cluster-side agent
3. remaining host agents
4. remaining cluster agents

Operational rule:

- each agent only changes `SIGNALFORGE_URL`
- tokens remain source-bound and unchanged unless source enrollment itself changes

Acceptance criteria:

- agent jobs no longer fail with `HTTP 413`
- dashboard, Sources, and run-detail flows remain stable after cutover

### Slice 5: ACA as Primary App Endpoint

After ACA acceptance, treat ACA as the app endpoint and keep Vercel in the preview/review role.

Cutover tasks:

- finalize DNS or production URL
- point agents to the ACA URL
- verify live collection from:
  - one host
  - one cluster
- keep Vercel deployment available during the rollback window

Acceptance criteria:

- production host-agent collection succeeds
- production cluster-agent collection succeeds
- no new API incompatibilities appear

## Rollback Plan

Rollback should stay operationally simple:

- keep Neon unchanged
- keep Vercel deployment alive during cutover
- revert agent `SIGNALFORGE_URL` to the previous production endpoint if ACA has an operational issue

Do not decommission Vercel until:

- ACA has passed real host and cluster artifact ingestion
- agents have run stably for a meaningful observation window

## Risks

### 1. Containerization surprises

Risk:

- Next.js build/runtime assumptions, static assets, or sql.js wasm lookup may behave differently in a container

Mitigation:

- validate image locally before ACA work
- add one focused smoke test against the built container

### 2. Cold-start and operator responsiveness

Risk:

- scale-to-zero may add enough latency to make queued-job pickup feel degraded

Mitigation:

- start with `minReplicas=1` if responsiveness is more important than lowest idle cost
- only reduce to zero after observing agent behavior

### 3. Secret and env drift

Risk:

- ACA env vars differ from Vercel env configuration and cause production-only failures

Mitigation:

- document the full env contract in-repo
- validate staging with the real provider config path before production cutover

### 4. Hidden upload ceilings elsewhere

Risk:

- a proxy or ingress layer in front of ACA could still reintroduce upload size problems

Mitigation:

- explicitly test host and Kubernetes artifacts that were too large for Vercel

## Recommended Sequence

1. Containerize SignalForge
2. Document ACA deployment contract
3. Deploy staging ACA app against Neon
4. Validate real host and cluster uploads
5. Cut over agents to ACA
6. Keep Vercel for preview or rollback until stable

## Success Criteria

This phase is complete when:

- SignalForge runs in ACA with Neon Postgres
- host-agent `linux-audit-log` uploads succeed where Vercel previously returned `413`
- cluster-agent `kubernetes-bundle` uploads succeed under the same production path
- operators can use always-on host and cluster agents without the hosting layer being the bottleneck
- Vercel is no longer part of the production ingestion-critical path
