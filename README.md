# SignalForge

**Infrastructure diagnostics control plane.** SignalForge ingests external evidence artifacts, extracts deterministic findings, and helps operators answer three questions:

- What did this artifact show?
- What changed since the last run?
- What should I do now?

Analysis is deterministic-first and grounded in evidence, with one optional LLM pass for explanation and prioritization. Collection and fix execution stay external — SignalForge does not SSH into hosts, run `kubectl`, or execute collectors itself.

## What it analyzes

| Artifact family | Evidence |
|---|---|
| `linux-audit-log` | Linux / WSL host audit logs |
| `container-diagnostics` | Text diagnostics for a single container or workload |
| `kubernetes-bundle` | UTF-8 JSON Kubernetes evidence bundles |
| `mac-diagnostics` | Structured macOS workstation diagnostics |

## Quick start

Requires [Bun](https://bun.sh) 1.3.11.

```bash
bun install
cp .env.example .env.local
bun run dev                 # http://localhost:3000
```

Submit a sample artifact and read the result:

```bash
./scripts/analyze.sh tests/fixtures/sample-prod-server.log
./scripts/signalforge-read.sh run <run-id>
```

No LLM key is required — SignalForge falls back to deterministic analysis. Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Use it with an AI agent

SignalForge is built to be driven by agents. There are two paths — both with copy-paste prompts in [docs/ai-agents.md](docs/ai-agents.md).

**Run or operate it.** Open the repo in a coding agent (Claude Code, Cursor, Codex) and point it at [AGENTS.md](AGENTS.md):

> Read AGENTS.md and docs/getting-started.md, then get SignalForge running locally and submit tests/fixtures/sample-prod-server.log as a smoke test.

**Integrate it.** Let an external agent request diagnostics over HTTP and read findings back, with a recommend-only trust boundary:

```bash
# after an operator enrolls an automation-agent token for a Source
export SIGNALFORGE_BASE_URL=https://your-signalforge.example
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=<token>
python3 examples/automation_agent_client.py --summary-only
```

## Ecosystem

| Repo | Role |
|---|---|
| `signalforge` | Analysis and control plane — ingests, analyzes, stores, presents |
| [`signalforge-agent`](https://github.com/Canepro/signalforge-agent) | Job-driven collection agent — runs collectors, uploads artifacts |
| [`signalforge-collectors`](https://github.com/Canepro/signalforge-collectors) | Collector scripts — produce the evidence artifacts |

## Configuration

SignalForge runs on SQLite with no configuration. The common settings:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_DRIVER` | `sqlite` | `sqlite` (local) or `postgres` (production) |
| `DATABASE_URL` | — | Postgres connection string when `DATABASE_DRIVER=postgres` |
| `SIGNALFORGE_ADMIN_TOKEN` | — | Enables the Sources UI and operator / agent APIs |
| `LLM_PROVIDER` | `openai` | Optional: `openai` or `azure`; omit to use deterministic fallback |

LLM setup and the full environment reference: [.env.example](.env.example), [docs/getting-started.md](docs/getting-started.md), and [docs/aca-env-contract.md](docs/aca-env-contract.md).

## Documentation

| Path | Contents |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Local setup and first run |
| [docs/ai-agents.md](docs/ai-agents.md) | Running and integrating SignalForge with AI agents |
| [docs/api-contract.md](docs/api-contract.md) | HTTP API reference |
| [docs/operators/README.md](docs/operators/README.md) | Sources, agents, and collection |
| [docs/aca-app-deployment.md](docs/aca-app-deployment.md) | Container / Azure Container Apps deployment |
| [docs/README.md](docs/README.md) | Full documentation index |
| [AGENTS.md](AGENTS.md) | Architecture and working rules for agents in this repo |

## License

MIT
