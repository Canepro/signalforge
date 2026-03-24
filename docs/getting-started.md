# Getting Started With SignalForge

This guide is for someone new to the repo who wants to get SignalForge running and complete a first successful run without needing to understand the whole codebase first.

## What You Will Do

By the end of this guide, you will:

1. start SignalForge locally
2. submit a sample artifact
3. inspect the run in the UI or CLI
4. understand what reanalyze and compare mean

## What SignalForge Does Today

SignalForge analyzes infrastructure evidence artifacts and turns them into:

- findings
- summaries
- top actions
- drift comparisons between runs

Today, the shipped analyzer supports one artifact family:

- `linux-audit-log`

That currently means Linux and WSL audit logs generated in the `signalforge-collectors` style.

## Before You Start

You need:

- Bun installed
- a local checkout of this repo
- optionally, OpenAI or Azure OpenAI credentials for richer summaries

SignalForge still works without LLM credentials.
If the provider is unavailable, it uses a deterministic fallback report.

## Step 1: Install Dependencies

From the repo root:

```bash
bun install
```

## Step 2: Configure Environment Variables

Start with the example file:

```bash
cp .env.example .env.local
```

Minimum local setup:

```env
DATABASE_DRIVER=sqlite
DATABASE_PATH=./signalforge.db
```

For durable deployment or serverless environments, use Postgres instead:

```env
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://user:password@host:5432/signalforge
```

Then apply migrations before starting the app:

```bash
bun run db:migrate:postgres
```

**Sources / “Collect Fresh Evidence” (Phase 6c):** to use **`/sources`** in the UI or the operator HTTP APIs (`/api/sources`, collection jobs, agent enrollment), set a bootstrap secret:

```env
SIGNALFORGE_ADMIN_TOKEN=choose-a-long-random-secret
```

Restart the dev server, open **`/sources`**, and sign in at **`/sources/login`** with the same value (stored as an httpOnly cookie — not embedded in the JS bundle). For `curl`, send `Authorization: Bearer <same value>`.

**External agent (Phase 6d):** after you create a source in **`/sources`**, use **Enroll agent** (or `POST /api/agent/registrations` with the admin Bearer) to get a **source-bound agent token**. That token is used as `Authorization: Bearer <agent_token>` on `POST /api/agent/heartbeat`, `GET /api/agent/jobs/next`, and the collection-job **claim / start / fail / artifact** routes documented in [`api-contract.md`](./api-contract.md). Collection still runs on the host outside SignalForge; the server only accepts the artifact and runs the same analysis path as `POST /api/runs`.

Optional OpenAI direct setup:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5-mini
DATABASE_DRIVER=sqlite
DATABASE_PATH=./signalforge.db
```

Optional Azure OpenAI setup — **pick the shape that matches your Azure resource URL**:

**Legacy resource root** (Cognitive Services or `*.openai.azure.com` without `/openai/v1`). API version is **required**:

```env
LLM_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=your_key_here
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini
DATABASE_DRIVER=sqlite
DATABASE_PATH=./signalforge.db
```

**OpenAI v1 base URL** (`.../openai/v1/`). **Omit `AZURE_OPENAI_API_VERSION`** — v1 endpoints reject the `api-version` query (you would see *400 API version not supported*).

```env
LLM_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/openai/v1/
AZURE_OPENAI_API_KEY=your_key_here
AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini
DATABASE_DRIVER=sqlite
DATABASE_PATH=./signalforge.db
```

If you are just trying the app locally, it is fine to leave the LLM settings unset and use fallback behavior first.

## Step 3: Start the App

```bash
bun run dev
```

By default, Next starts on `http://localhost:3000` unless that port is already in use.

Keep that terminal running.

## Step 4: Submit Your First Artifact

In the UI, use **How to collect** in the sidebar (or **Collect externally** on the dashboard) for copy-paste commands that use **this** app’s URL — collection still runs **outside** SignalForge; the panel only helps you wire `SIGNALFORGE_URL` and the reference collector.

The simplest first run is one of the repo fixtures:

```text
tests/fixtures/sample-prod-server.log
```

You have two easy ways to submit it.

### Option A: Use the UI

1. Open the app in a browser.
2. Click `Upload Artifact`.
3. Choose `tests/fixtures/sample-prod-server.log`.
4. Wait for the redirect to the run detail page.

### Option B: Use the CLI helper

```bash
./scripts/analyze.sh tests/fixtures/sample-prod-server.log
```

That command submits the file to the local app and prints:

- `run_id`
- run URL
- compare UI and compare API URLs
- one-line `signalforge-read.sh` commands for `run` and `compare`

If your app is not on port `3000`, add `--url`:

```bash
./scripts/analyze.sh --url http://localhost:3001 tests/fixtures/sample-prod-server.log
```

## Step 5: Inspect the Result

You can inspect a run in three ways.

### In the UI

Look at:

- the dashboard home page
- the run detail page
- the compare page later when you have more than one run

### With the read helper

```bash
./scripts/signalforge-read.sh run <run-id>
./scripts/signalforge-read.sh report <run-id>
./scripts/signalforge-read.sh compare <run-id>
```

This is useful when you want raw JSON, or when another script or agent is consuming SignalForge.

### With raw HTTP

```bash
curl http://localhost:3000/api/runs
curl http://localhost:3000/api/runs/<run-id>
curl http://localhost:3000/api/runs/<run-id>/report
curl http://localhost:3000/api/runs/<run-id>/compare
```

## Step 6: Understand Reanalyze vs Compare

These two actions sound similar, but they are different.

- **Reanalyze** means: run the analyzer again on the same stored artifact
- **Compare** means: diff two runs and show what changed

Important:

- implicit compare uses the latest older run for the same logical target
- that is not always the same as the reanalyze parent
- if you want an exact baseline, use explicit `against`

Example:

```bash
./scripts/signalforge-read.sh compare <run-id> --against <other-run-id>
```

The UI also exposes a **vs parent** path when lineage exists.

## Step 7: Try the External Collector Path

SignalForge is designed to analyze evidence, not collect it directly.

There is a reference collector in the companion repo [signalforge-collectors](https://github.com/Canepro/signalforge-collectors) (`submit-to-signalforge.sh` at the repo root).

Example:

```bash
git clone https://github.com/Canepro/signalforge-collectors.git
cd signalforge-collectors
./submit-to-signalforge.sh --file examples/sample_audit.log --url http://localhost:3000
```

This proves the external push model:

- the collector produces evidence
- the collector submits it with metadata via `POST /api/runs`
- SignalForge stores the run and analyzes it

For **job-driven** collection (Sources → “Collect Fresh Evidence”), use the separate execution-plane repo **`signalforge-agent`** (sibling repo, not yet published): it authenticates with an enrollment token, polls `GET /api/agent/jobs/next`, runs **signalforge-collectors** on the host, and completes `POST /api/collection-jobs/{id}/artifact`. See that README for env vars and `once` / `run` modes.

## Step 8: Useful Commands

Typecheck:

```bash
bun run typecheck
```

Tests:

```bash
bun test
```

Storage parity tests (SQLite always; Postgres when `DATABASE_URL_TEST` is set):

```bash
bun run test:parity
```

Production build:

```bash
bun run build
```

Postgres migrations:

```bash
bun run db:migrate:postgres
```

Direct analyzer run without the web app:

```bash
bun run analyze tests/fixtures/wsl-mar2026-full.log
```

## Step 9: Where To Go Next

If you want:

- a docs map: read [`README.md`](./README.md)
- a repo overview: read [`../AGENTS.md`](../AGENTS.md)
- the long-term plan: read [`../plans/roadmap.md`](../plans/roadmap.md)
- the current state: read [`../plans/current-plan.md`](../plans/current-plan.md)
- the HTTP integration contract: read [`api-contract.md`](./api-contract.md)
- the external collector submission contract: read [`external-submit.md`](./external-submit.md)

## Troubleshooting

### The app starts on a different port

If `3000` is in use, Next may choose `3001` or another port.
Use that port in:

- your browser
- `--url` for helper scripts
- `SIGNALFORGE_URL`

### The LLM is unavailable

SignalForge still analyzes the artifact and returns a deterministic fallback report.

### The helper scripts fail to connect

Check:

- the app is running
- the port is correct
- you passed the correct `--url`

### Compare looks surprising

Remember:

- implicit compare is target-based
- explicit `against` pins the baseline
- reanalyze lineage and compare baseline are related but not identical
