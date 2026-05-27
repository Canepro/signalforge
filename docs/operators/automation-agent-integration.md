# Automation-Agent Integration

Use this guide when you want an external operator agent to ask SignalForge for
diagnostics on a monitored Source and read the resulting findings back.

This is an **HTTP integration**, not a plugin loaded into the SignalForge app process.

## What This Actor Is

SignalForge now has three distinct actors:

- **operator/admin**: creates Sources, enrolls tokens, and manages collection
- **execution agent**: heartbeats, claims jobs, runs collectors locally, and uploads artifacts
- **automation agent**: asks SignalForge to collect diagnostics for a bound Source and polls back the findings

Keep these roles separate:

- the automation agent does **not** reuse the execution-agent token
- the automation agent does **not** claim jobs or upload artifacts
- SignalForge stays the control plane and analysis plane

## Connection Model

The external automation agent connects to SignalForge over HTTPS with a **source-bound automation-agent token**.

Current flow:

1. An operator creates a Source in SignalForge.
2. An operator enrolls an automation-agent token for that Source.
3. The external automation agent stores:
   - `SIGNALFORGE_BASE_URL`
   - `SIGNALFORGE_AUTOMATION_AGENT_TOKEN`
4. The external automation agent:
   - optionally polls `GET /api/automation-agent/signals/next`
   - `POST /api/automation-agent/diagnostic-requests`
   - `GET /api/automation-agent/diagnostic-requests/[id]`
5. The existing execution agent collects and uploads the artifact through the normal collection-job path.
6. SignalForge analyzes the run and the automation agent polls back the structured findings envelope.

That means the automation agent talks only to SignalForge, not directly to the collector or runtime surface.

For autonomous Kubernetes actions, the automation agent still does not patch the cluster. It asks SignalForge to create a source-bound fix action after a fresh diagnostic run. SignalForge persists an exact `action_payload` for the execution-plane agent: policy id, workload target, namespace, server-side apply manifest, and changed fields. The execution-plane agent claims that action, performs the dry-run/apply sequence, and uploads evidence through SignalForge APIs.

## Easiest Setup

The easiest bootstrap path is the helper script:

```bash
./scripts/signalforge-automation-agent.sh register <source-id> --display-name openclaw --print-exports
```

Required env for registration:

```bash
export SIGNALFORGE_BASE_URL=http://localhost:3000
export SIGNALFORGE_ADMIN_TOKEN=your-admin-token
```

By default, the script keeps **stdout** machine-readable and prints only the JSON response body. With `--print-exports`, it also prints ready-to-export environment lines to **stderr** for a shell bootstrap flow:

```bash
export SIGNALFORGE_BASE_URL=http://localhost:3000
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=<token>
```

That split is intentional:

- stdout stays safe for another agent or script to parse as JSON
- stderr can still carry human-friendly export lines when you want a quick shell setup

## Local End-To-End Smoke

When you want to prove the full contract locally, including the execution-agent side, use the repo smoke script:

```bash
bun run smoke:automation-agent
```

That script can:

- boot a temporary local SignalForge dev server with an isolated SQLite file
- create a Source
- enroll both an execution-agent token and an automation-agent token
- queue a diagnostics request through the automation-agent API
- satisfy that job through the execution-agent HTTP routes
- upload a real fixture artifact
- poll the final structured findings envelope back through the automation-agent API

The default fixture is:

```text
tests/fixtures/sample-prod-server.log
```

If you already have a local app running, reuse it instead:

```bash
SIGNALFORGE_ADMIN_TOKEN=your-admin-token \
bash ./scripts/smoke-automation-agent-local.sh --url http://127.0.0.1:3000
```

The smoke output prints stable summary lines such as:

- `source_id`
- `request_id`
- `job_id`
- `run_id`
- `request_status`
- `top_action`

That makes it useful both for human checks and for shell or CI wrappers.

## External Agent Workflow

Once the automation-agent token is set, the external agent has three normal operations.

## Example Client

For a small copy-and-adapt reference client, use:

- [`../../examples/automation_agent_client.py`](../../examples/automation_agent_client.py)
- [`../../examples/openclaw_recommendation_handoff.py`](../../examples/openclaw_recommendation_handoff.py)

It is intentionally dependency-free and uses only the Python standard library.
The example is aimed at agents that need a thin wrapper around the
automation-agent HTTP API.

Example usage:

```bash
export SIGNALFORGE_BASE_URL=http://localhost:3000
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=<token>
python3 examples/automation_agent_client.py --summary-only
```

That example:

- queues a diagnostic request
- waits until the request reaches a terminal state
- prints either the full response JSON or a reduced agent-friendly summary

The `--summary-only` output is useful when the external agent wants the most important fields without re-wrapping the full SignalForge payload itself.

## Recommendation-Only Handoff

If you want an external agent to turn the SignalForge result into operator
guidance without any execution rights, use:

```bash
python3 examples/openclaw_recommendation_handoff.py
```

That example either:

- fetches a fresh `--summary-only` SignalForge result directly, or
- consumes a saved summary with `--summary-file`

It outputs a JSON handoff with:

- `policy`: explicit no-execution / no-remediation constraints
- `signalforge_summary`: the evidence summary from SignalForge
- `agent_system_prompt`: recommendation-only system guidance
- `agent_user_prompt`: the downstream prompt text for the external agent

Example prompt-only usage:

```bash
export SIGNALFORGE_BASE_URL=http://localhost:3000
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=<token>
python3 examples/openclaw_recommendation_handoff.py --prompt-only
```

If you want to inspect the handoff shape without a live SignalForge instance, use the checked-in sample summary fixture:

```bash
python3 examples/openclaw_recommendation_handoff.py \
  --summary-file tests/fixtures/automation-agent-summary-sample.json \
  --prompt-only
```

That produces a downstream recommendation prompt shaped like this:

```text
User goal:
Recommend the next safest operator actions for this monitored source.

SignalForge summary JSON:
{
  "request_id": "sample-request-id",
  "status": "submitted",
  "run_id": "sample-run-id",
  "artifact_type": "linux-audit-log",
  "target_identifier": "sample-prod-server",
  "severity_counts": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 0
  },
  "top_action": "Confirm whether the public web listeners are intended, then restrict inbound access to approved sources at the firewall layer.",
  "finding_titles": [
    "HTTPS listener (TLS) reachable on all network interfaces (port 443)",
    "HTTP listener (web) reachable on all network interfaces (port 80)",
    "Filesystem warning observed for a mounted data volume"
  ],
  "compare_api": "/api/runs/sample-run-id/compare"
}

Respond with:
1. A short situation summary
2. The most important risks or signals, ordered by urgency
3. A flat list of recommended next actions for a human operator
4. Any assumptions or missing evidence that should be checked before remediation

Important constraints:
- Recommendation only
- No command execution
- No claim of live access to the monitored device
- Stay grounded in the SignalForge evidence
```

This keeps the trust boundary clean:

- SignalForge diagnoses
- the external agent recommends
- neither example implies permission to execute fixes on the monitored device

### 1. Queue diagnostics

```bash
./scripts/signalforge-automation-agent.sh request --reason "investigate target drift"
```

This creates a normal `CollectionJob` for the token's bound Source.

Important limits:

- the token decides the Source
- the caller cannot override `source_id`
- the caller cannot override `artifact_type`
- the caller cannot override `collection_scope`

### 2. Poll once

```bash
./scripts/signalforge-automation-agent.sh poll <request-id>
```

This returns:

- `request`: job lifecycle state and links
- `result`: `null` until a linked run exists, then the structured findings payload

### 3. Wait through completion

```bash
./scripts/signalforge-automation-agent.sh wait <request-id> --timeout 600
```

This polls until the request reaches a terminal state:

- `submitted`
- `failed`
- `cancelled`
- `expired`

For `submitted`, the final JSON includes the linked run result envelope.

## What The Result Contains

When analysis is available, `result` includes:

- `run_id`, `artifact_id`, `artifact_type`, `target_identifier`
- run `status`
- `severity_counts`
- `summary`
- `top_actions_now`
- `findings`
- `environment_context`
- `is_incomplete`, `incomplete_reason`, `analysis_error`
- links to the run, report, and compare API

That payload is meant to be easy for another agent to consume directly without having to stitch together multiple SignalForge reads.

## Wrapper Integration Pattern

For operators running per-source Bash wrappers around the automation-agent API, a
normalized summary shape is recommended so every source emits the same structure
regardless of artifact type.

The recommended normalized output for a `collect-summary` command:

```json
{
  "source_slug":       "<source-target-identifier>",
  "target_identifier": "<target>",
  "request_id":        "<uuid>",
  "run_id":            "<uuid>",
  "artifact_type":     "<kubernetes-bundle|linux-audit-log|container-diagnostics|...>",
  "status":            "<complete|error|...>",
  "request_status":    "<submitted|failed|cancelled|expired>",
  "severity_counts":   {"critical": 0, "high": 0, "medium": 0, "low": 0},
  "top_findings":      ["<finding title>", "..."],
  "links":             {
    "run":     "<base-url>/runs/<run-id>",
    "report":  "<base-url>/runs/<run-id>/report",
    "compare": "/api/runs/<run-id>/compare"
  },
  "collected_at":      "<ISO-8601 timestamp of request submission>",
  "completed_at":      "<ISO-8601 timestamp of request completion>"
}
```

When the request or analysis failed, include:

```json
{
  "error": "<analysis_error or request error_message>"
}
```

Field notes:

- `source_slug` — stable source target identifier; set from the wrapper constant, not the API response
- `status` — run/analysis status from `result.status`; `null` if no result yet
- `request_status` — request lifecycle status from `request.status`
- `top_findings` — up to 5 finding titles from `result.findings[].title`; falls back to `result.top_actions_now` if findings are empty
- `collected_at` — from `request.submitted_at`
- `completed_at` — from `request.finished_at` when present, otherwise `request.submitted_at`
- `links.run` — from `result.links.run` or synthesized as `<base-url>/runs/<run-id>`

**Delayed result race:** `request.status` may become `submitted` before `result.run_id`
is populated. Wrappers should retry polling for `result.run_id` after reaching
`submitted` before emitting the normalized summary.

## Minimal Raw HTTP Examples

Register:

```bash
curl -X POST \
  -H "Authorization: Bearer ${SIGNALFORGE_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source_id":"<source-id>","display_name":"openclaw"}' \
  "${SIGNALFORGE_BASE_URL%/}/api/automation-agent/registrations"
```

Request diagnostics:

```bash
curl -X POST \
  -H "Authorization: Bearer ${SIGNALFORGE_AUTOMATION_AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"request_reason":"investigate target drift"}' \
  "${SIGNALFORGE_BASE_URL%/}/api/automation-agent/diagnostic-requests"
```

Poll:

```bash
curl \
  -H "Authorization: Bearer ${SIGNALFORGE_AUTOMATION_AGENT_TOKEN}" \
  "${SIGNALFORGE_BASE_URL%/}/api/automation-agent/diagnostic-requests/<request-id>"
```

## What This Is Not

- not an embedded plugin API
- not a websocket session
- not a replacement for the execution agent
- not a remediation channel in v1

Future execution or remediation should use a separate higher-trust action model, not this diagnostics token.

## Related Docs

- [`../api-contract.md`](../api-contract.md)
- [`sources-and-agents.md`](./sources-and-agents.md)
- [`collection-paths.md`](./collection-paths.md)
- [`../agent-deployment.md`](../agent-deployment.md)
