# ACA App Deployment

This document is the Slice 2 deployment contract for moving SignalForge app hosting from Vercel to Azure Container Apps without changing the database provider or the agent contract.

## Findings

- SignalForge is now a normal containerized web and API service, not a function-only fit.
- The hard production blocker is hosted artifact ingestion size, not database placement.
- Phase 1 should keep Neon Postgres and avoid mixing app-hosting migration with database migration.

## Locked decisions

### App shape

- deploy one Azure Container App for SignalForge web and API
- do not split upload, API, and UI into separate apps in the first ACA cut
- keep Vercel previews if they remain useful for PR review, but keep production agent traffic off Vercel

### Database stance

- keep `DATABASE_DRIVER=postgres`
- keep Neon Postgres for phase 1
- apply the checked-in Postgres migrations before first ACA traffic tests

### Ingress model

- use public ACA ingress for the first cut
- terminate HTTPS at ACA
- expose the app on target port `3000`
- do not add Front Door, private ingress, or another proxy layer in Slice 2

Rationale: the current problem is direct artifact upload capacity, so the first fix should remove extra moving parts rather than introducing another ingress boundary that might reintroduce body-size uncertainty.

### Secret model

- store `DATABASE_URL`, `SIGNALFORGE_ADMIN_TOKEN`, and provider API keys as ACA secrets
- inject non-secret configuration as normal ACA environment variables
- do not put secrets into the image, source tree, or client bundle

### Revision strategy

- use ACA revisions for deploy and rollback
- keep the first cut operationally simple: one active revision at a time
- treat config changes as revision-producing deploys, not mutable in-place edits

Rationale: Slice 2 needs predictable rollback more than traffic splitting.

### Replica policy

- staging: `minReplicas=0`
- production: `minReplicas=1`

Rationale: staging can tolerate cold starts to save idle cost. Production should prefer faster agent poll and artifact upload responsiveness over absolute zero-idle cost. Revisit only after staging proves the cold-start profile is acceptable for the agent path.

## Required ACA configuration

An operator should not have to guess these values:

| Setting | Value |
|---|---|
| app count | one container app |
| exposed endpoint | public HTTPS ACA ingress |
| target port | `3000` |
| image | current SignalForge app image from Slice 1 |
| storage backend | Neon Postgres via `DATABASE_DRIVER=postgres` |
| health check | `GET /api/health` |
| operator API secret | `SIGNALFORGE_ADMIN_TOKEN` |
| revision mode | single active revision |
| staging minimum replicas | `0` |
| production minimum replicas | `1` |

For exact app variables and secret classification, use [`aca-env-contract.md`](./aca-env-contract.md).

## Staging rollout contract

Before any production cutover:

1. deploy a staging ACA app with the Slice 1 image
2. wire staging to a safe Postgres target that follows the same `postgres` app path
3. confirm `GET /api/health` returns `200`
4. confirm the dashboard opens
5. confirm `/api/runs` responds
6. confirm one real artifact upload succeeds
7. confirm the Sources UI, agent enrollment, and collection-job flow still behave correctly

## Rollback contract

If the ACA staging or production rollout regresses:

1. stop new traffic from moving to the bad ACA revision
2. reactivate the previous known-good ACA revision
3. if production cutover had already started, point agents back at the previous production origin
4. leave Neon unchanged during rollback

Do not combine rollback with a database move.

## Verification gates for Slice 3

Slice 2 is only complete when the repo documents enough to let an operator stand up the first ACA app without guessing:

- app shape is explicit
- ingress decision is explicit
- secret model is explicit
- required env vars are explicit
- min replica policy is explicit
- rollout and rollback path are explicit
