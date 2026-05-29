# Working with AI Agents

SignalForge is built to be driven by agents, not just people. There are two
distinct ways an agent fits in, and they use different entry points.

| You want an agent to… | Use | Start here |
|---|---|---|
| **Run, operate, or extend SignalForge** — a coding agent working in this repo | The repo handoff + setup docs | [Operate it with a coding agent](#operate-it-with-a-coding-agent) |
| **Consume SignalForge** — request diagnostics and read findings over HTTP | The automation-agent API | [Integrate it as an automation agent](#integrate-it-as-an-automation-agent) |

> **Scope.** This guide covers general-purpose AI agents such as Claude Code,
> Cursor, and Codex. It is **not** about the execution-plane collection agent
> that runs collectors on a host — that is `signalforge-agent`, documented in
> [`agent-deployment.md`](./agent-deployment.md).

## Operate it with a coding agent

If you have opened this repo in an AI coding agent, it can get SignalForge
running for you. The repo already carries its own handoff file,
[`AGENTS.md`](../AGENTS.md), with the architecture, commands, working rules, and
mandatory test fixtures — point your agent at it first.

**Get it running** — copy-paste this prompt:

```text
Read AGENTS.md and docs/getting-started.md, then:
1. Install dependencies and start SignalForge locally.
2. Submit tests/fixtures/sample-prod-server.log as a smoke test.
3. Read the run back and show me the findings and top actions.
Use Bun, not npm. No LLM key is needed — deterministic fallback is fine.
```

Under the hood, that is this sequence:

```bash
bun install
cp .env.example .env.local          # SQLite defaults; LLM optional
bun run dev                          # http://localhost:3000
./scripts/analyze.sh tests/fixtures/sample-prod-server.log
./scripts/signalforge-read.sh run <run-id>
```

**Verify a change** — copy-paste this prompt:

```text
Run the project checks and report exactly what passed or failed:
  bun run typecheck && bun run test
When changing findings logic, validate against the fixtures listed in AGENTS.md
("Test Anchors") first.
```

Helpful context for any agent working in the repo:

- [`AGENTS.md`](../AGENTS.md) — architecture, working rules, commands, test anchors
- [`getting-started.md`](./getting-started.md) — first-run setup
- [`../plans/current-plan.md`](../plans/current-plan.md) — what is shipped today

## Integrate it as an automation agent

SignalForge exposes a first-class HTTP surface for an external agent to **request
diagnostics on a monitored Source and read the findings back** — without giving
that agent any access to the target machine. This is the **automation-agent**
role.

The trust boundary is deliberate:

- SignalForge **diagnoses** — analyzes evidence and returns structured findings
- your agent **recommends** — turns findings into operator guidance
- neither one **executes** fixes on the target through this channel

### Setup (one time, by an operator)

First enable the operator APIs by setting `SIGNALFORGE_ADMIN_TOKEN` (see
[`getting-started.md`](./getting-started.md)). Then:

1. Create a Source in the `/sources` UI.
2. Enroll and run the execution-plane agent for that Source. Use the `/sources`
   **Enroll agent** flow and the `signalforge-agent` deployment steps in
   [`agent-deployment.md`](./agent-deployment.md). This agent must be
   heartbeating so it can claim queued collection jobs, run the collector, and
   upload the artifact that SignalForge analyzes.
3. Enroll a **source-bound automation-agent token** for it. This is a separate
   token from the `/sources` **Enroll agent** button (that one is for the
   execution agent). The bootstrap helper prints ready-to-export lines:

   ```bash
   export SIGNALFORGE_BASE_URL=http://localhost:3000
   export SIGNALFORGE_ADMIN_TOKEN=<your-admin-token>
   ./scripts/signalforge-automation-agent.sh register <source-id> \
     --display-name operator-agent --print-exports
   ```

4. Hand the agent the two values it needs — and nothing else:

   ```bash
   export SIGNALFORGE_BASE_URL=https://your-signalforge.example
   export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=<token>
   ```

The token decides the Source and artifact type; the caller **cannot** override
`source_id`, `artifact_type`, or `collection_scope`.

### What to tell your agent

Copy-paste this prompt once the token is set:

```text
You can ask SignalForge to run diagnostics on my monitored source and read the
results back. Use the ready-made client:

  python3 examples/automation_agent_client.py --summary-only

It queues a diagnostic request, waits for it to finish, and prints a compact
summary (severity counts, top action, finding titles). Summarize the result and
recommend the safest next operator actions, ordered by urgency. Recommend only —
do not claim you can execute fixes on the target.
```

Under the hood, the agent uses two routes:

- `POST /api/automation-agent/diagnostic-requests` — queue a request
- `GET  /api/automation-agent/diagnostic-requests/{id}` — poll status and findings

### Ready-made examples

Both are dependency-free (Python standard library only) and meant to be copied
and adapted:

- [`../examples/automation_agent_client.py`](../examples/automation_agent_client.py)
  — queue a request, wait for completion, and print the full result or a reduced
  `--summary-only` view.
- [`../examples/recommendation_handoff.py`](../examples/recommendation_handoff.py)
  — wrap a SignalForge summary into a recommendation-only prompt for a downstream
  agent, with explicit no-execution constraints baked in.

### Prove the full loop locally

One command boots a temporary local app, enrolls both agent tokens, queues a
request, satisfies it with a real fixture, and prints the resulting `run_id`:

```bash
bun run verify:automation-agent
```

### Deeper references

- [`operators/automation-agent-integration.md`](./operators/automation-agent-integration.md)
  — full connection model, polling, result envelope, and wrapper patterns
- [`api-contract.md`](./api-contract.md) — every route, request, and response shape
- [`operators/autonomous-kubernetes-actions.md`](./operators/autonomous-kubernetes-actions.md)
  — the separate, higher-trust model for opt-in Kubernetes safe-fix actions
