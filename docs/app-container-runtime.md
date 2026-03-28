# Container Deployment Contract

This document is the Slice 1 runtime contract for running SignalForge as a production container before any Azure-specific deployment work.

## Current decision

- build with Bun to stay aligned with the repo and CI
- run the built app as a normal Node process using Next standalone output
- keep `DATABASE_DRIVER=postgres` with Neon Postgres for the first ACA cut
- keep SQLite support for local development and local container smoke checks only

This slice does **not** change Azure resources, DNS, or the database provider.

## Runtime contract

### Required for production containers

| Variable | Why it matters |
|---|---|
| `DATABASE_DRIVER=postgres` | Locks production onto the durable multi-instance backend |
| `DATABASE_URL` | Required by the Postgres storage implementation |

### Required when using operator APIs or Sources UI

| Variable | Why it matters |
|---|---|
| `SIGNALFORGE_ADMIN_TOKEN` | Enables `/sources`, `/api/sources`, collection-job APIs, and agent enrollment |

### Optional LLM variables

SignalForge still boots without LLM credentials and falls back to deterministic explanation and prioritization.

- OpenAI direct: `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, optional `OPENAI_MODEL`
- Azure OpenAI legacy: `LLM_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`
- Azure OpenAI `/openai/v1`: `LLM_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`

### Runtime bind variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Container listen port |
| `HOSTNAME` | `0.0.0.0` in the committed image | Required so the container is reachable from outside the process |

## Health endpoint

Use `GET /api/health` as the container boot/readiness check for Slice 1.

Behavior:

- returns `200` when the storage runtime contract is valid for the selected driver
- returns `503` when required storage env is missing or `DATABASE_DRIVER` is invalid
- reports LLM configuration and admin API enablement without failing the app, because both already have valid fallback or opt-in behavior

This endpoint is intentionally config-focused. It does **not** prove live database reachability or outbound LLM connectivity.

## Local build and smoke commands

Build the image:

```bash
docker build -t signalforge:slice1 .
```

Minimal boot smoke with default SQLite:

```bash
docker run --rm -p 3000:3000 signalforge:slice1
curl http://127.0.0.1:3000/api/health
```

Production-like boot smoke with Postgres:

```bash
docker run --rm --network host \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL=postgres://user:password@127.0.0.1:5432/signalforge \
  -e SIGNALFORGE_ADMIN_TOKEN=replace-me \
  signalforge:slice1
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/runs
```

Before using the Postgres path, apply migrations against the target database:

```bash
bun run db:migrate:postgres
```

## sql.js note

SQLite is not the production target for ACA phase 1, but the image still preserves the `sql.js` WASM lookup path for local or dev-style SQLite code paths. The runtime resolver checks traced standalone output first, then the normal `node_modules/sql.js/dist` path.
