# Postgres Validation

This document records the first live end-to-end validation pass for the Postgres backend.

It is not a marketing claim. It is an operator-facing reproduction note.

## Validated On

- Date: `2026-03-24`
- App: SignalForge local dev server
- Backend: `Postgres 16-alpine`
- Runtime: WSL
- Collector path: `signalforge-agent` running `first-audit.sh` from `signalforge-collectors`

## Environment

Example environment used for the successful run:

```env
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/signalforge
SIGNALFORGE_ADMIN_TOKEN=choose-a-long-random-secret
```

Start Postgres:

```bash
podman run --rm \
  --name signalforge-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=signalforge \
  -p 5432:5432 \
  docker.io/library/postgres:16-alpine
```

Apply migrations:

```bash
bun run db:migrate:postgres
```

Migration discipline for future schema changes:

- [`postgres-migrations.md`](./postgres-migrations.md)

Start the app:

```bash
PORT=3006 bun run dev
```

## Flows Validated

### Run ingestion and readback

- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/{id}`
- `GET /api/runs/{id}/report`
- `GET /api/runs/{id}/compare`
- `POST /api/runs/{id}/reanalyze`

Observed result:

- run persisted
- detail JSON contained findings, status, and metadata
- compare handled both `baseline_missing: true` and implicit baseline selection
- reanalyze created a linked child run

### Source and job control plane

- `POST /api/sources`
- `POST /api/agent/registrations`
- `POST /api/sources/{id}/collection-jobs`

Observed result:

- source created with `health_status: "unknown"`
- agent enrollment returned a token
- collection job queued successfully

### Agent execution lifecycle

- `signalforge-agent once`
- claim
- start
- heartbeat
- collector execution
- artifact upload
- terminal submit state

Observed result:

- job transitioned to `submitted`
- source health became `online`
- `result_analysis_status` persisted as `complete`
- a second `signalforge-agent once` observed no queued job

## Current Confidence

The Postgres adapter has passed:

- local typecheck
- full existing test suite
- production build
- one live end-to-end validation pass across the current product surface

## Remaining Hardening Work

- keep future schema changes append-only through new migration files
- validate upgrade paths across multiple Postgres migration versions
