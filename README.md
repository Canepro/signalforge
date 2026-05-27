# SignalForge

Infrastructure diagnostics control plane. SignalForge ingests external evidence artifacts, extracts deterministic findings, and helps operators answer three questions:

- What did this artifact show?
- What changed since the last run?
- What should I do now?

## Artifact Families

| Family | Description |
|---|---|
| `linux-audit-log` | Linux host audit logs via `signalforge-collectors` |
| `container-diagnostics` | Text-based diagnostics for a single container or workload |
| `kubernetes-bundle` | UTF-8 JSON Kubernetes evidence bundles |

## Ecosystem

| Repo | Role |
|---|---|
| `signalforge` | Analysis and control plane — ingests, analyzes, stores, presents |
| `signalforge-agent` | Job-driven collection agent — uploads artifacts to SignalForge |
| `signalforge-collectors` | Collector scripts — produces the evidence artifacts |

Collection and fix execution stay external. SignalForge does not SSH into servers, run `kubectl` internally, or execute collectors inside the app.

## Quick Start

Requires **Bun 1.3.11**.

```bash
bun install
cp .env.example .env.local
bun run dev
```

Submit a fixture and read back the result:

```bash
./scripts/analyze.sh tests/fixtures/sample-prod-server.log
./scripts/signalforge-read.sh run <run-id>
./scripts/signalforge-read.sh report <run-id>
```

Full walkthrough: [docs/getting-started.md](docs/getting-started.md)

## Configuration

**Required:**

| Variable | Description |
|---|---|
| `SIGNALFORGE_ADMIN_TOKEN` | Admin bootstrap token (Sources, agent, operator APIs) |
| `LLM_PROVIDER` | `openai`, `azure`, or `codex_app_server` (default: `openai`) |
| `OPENAI_API_KEY` | Required when `LLM_PROVIDER=openai` |

**Database:**

| Variable | Default | Description |
|---|---|---|
| `DATABASE_DRIVER` | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_PATH` | `./signalforge.db` | SQLite path (local dev) |
| `DATABASE_URL` | — | Postgres connection string (production) |

Full environment reference: [docs/aca-env-contract.md](docs/aca-env-contract.md)

LLM provider details: see `.env.example`

## LLM Providers

SignalForge supports OpenAI, Azure OpenAI, and Codex App Server. If no provider is configured or reachable, it falls back to deterministic analysis.

Local Codex smoke test:

```bash
bun run smoke:codex-brain
```

## CI and Deployment

| Workflow | Trigger | Action |
|---|---|---|
| `CI` | push to `main`, pull requests | typecheck, test, build, Postgres parity |
| `Publish App Image` | after `CI` on `main` | publishes GHCR image |
| `Deploy ACA App` | manual dispatch | deploys chosen image to Azure Container Apps |

Deployment docs: [docs/aca-app-deployment.md](docs/aca-app-deployment.md)

## Automation Agent

External AI agents can request diagnostics over HTTP using a source-bound automation-agent token.

```bash
bun run smoke:automation-agent
```

Docs: [docs/operators/automation-agent-integration.md](docs/operators/automation-agent-integration.md)

## Documentation

| Path | Contents |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Local setup walkthrough |
| [docs/README.md](docs/README.md) | Docs index |
| [docs/api-contract.md](docs/api-contract.md) | HTTP API reference |
| [docs/operators/README.md](docs/operators/README.md) | Operator docs index |
| [docs/agent-deployment.md](docs/agent-deployment.md) | Agent deployment |
| [plans/roadmap.md](plans/roadmap.md) | Roadmap |
| [AGENTS.md](AGENTS.md) | Agents and AI integration guide |

## License

MIT
