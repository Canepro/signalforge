# HTTP API Contract

This is the published HTTP contract for the current SignalForge routes.

Use this document when you are:

- writing another tool or agent against SignalForge
- checking which routes are stable enough to consume
- looking for request and response shapes without reading every route handler

This is intentionally **not** a full OpenAPI deployment.
The route handlers in `src/app/api/` remain authoritative.
If a route changes in a breaking way, update this file and `docs/schemas/` at the same time.

**Base URL:** your deployment origin, for example `http://localhost:3000`. Paths below are relative.

**Auth (runs):** none — secure your deployment and network accordingly.

**Auth (Phase 6c operator routes):** `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>`. If the env var is unset, these routes return **503** with `code: admin_token_unconfigured`. This is bootstrap auth, not multi-user identity.

**Auth (Phase 6d agent routes):** `Authorization: Bearer <agent_token>` from `POST /api/agent/registrations` (one registration, one token per source). Invalid or missing token → **401**. Valid token but job belongs to another source, another agent holds the lease, or **`instance_id` does not match the job lease** → **403** (`instance_mismatch` where applicable). Missing required `instance_id` on a mutating call → **400**. Invalid lifecycle / duplicate submit → **409** (see per-route notes).

**Auth (automation-agent routes):** `Authorization: Bearer <automation_agent_token>` from `POST /api/automation-agent/registrations` (one registration, one token per source). Invalid or missing token → **401**. Valid tokens can only create or read diagnostic requests for their bound source; cross-source request reads return **403**.

**Unexpected server failures (selected JSON routes):** **500** responses use a stable body **`{ "error": "Internal server error", "code": "internal_error" }`** without echoing raw exception text. Operators should inspect server logs for the underlying failure.

## Quick Route Guide

| Route | Use it for |
|---|---|
| `POST /api/runs` | Submit new evidence |
| `GET /api/health` | Read runtime health for container and operator checks |
| `GET /api/runs` | List known runs |
| `GET /api/runs/[id]` | Read a run and its stored report |
| `GET /api/runs/[id]/report` | Read raw report JSON only |
| `GET /api/runs/[id]/compare` | Read deterministic compare data between runs |
| `POST /api/runs/[id]/reanalyze` | Re-run analysis on the same stored artifact |
| `POST /api/sources` | Register a **Source** (operator Bearer) |
| `GET /api/sources` | List sources (`?enabled=true` optional) |
| `GET /api/sources/[id]` | Get one source |
| `PATCH /api/sources/[id]` | Update mutable source fields |
| `POST /api/sources/[id]/collection-jobs` | Create a **queued** collection job |
| `GET /api/sources/[id]/collection-jobs` | List jobs for a source |
| `GET /api/collection-jobs/[id]` | Get one job |
| `POST /api/collection-jobs/[id]/cancel` | Cancel queued/claimed job |
| `POST /api/agent/registrations` | Enroll agent for a source (returns token once) |
| `POST /api/automation-agent/registrations` | Enroll automation agent for a source (returns token once) |
| `POST /api/agent/heartbeat` | Agent: capabilities, attributes, lease extension for active job |
| `GET /api/agent/jobs/next` | Agent: next **queued** jobs for bound source (optional `limit`; **no** `source_id` query) |
| `POST /api/collection-jobs/[id]/claim` | Agent: `queued` → `claimed` |
| `POST /api/collection-jobs/[id]/start` | Agent: `claimed` → `running` |
| `POST /api/collection-jobs/[id]/fail` | Agent: `claimed` \| `running` → `failed` |
| `POST /api/collection-jobs/[id]/artifact` | Agent: multipart artifact → same ingestion/analyzer path as `POST /api/runs`; job → **submitted** |
| `POST /api/automation-agent/diagnostic-requests` | Automation agent: queue a source-bound diagnostic request |
| `GET /api/automation-agent/diagnostic-requests/[id]` | Automation agent: poll job status and structured findings |
| `GET /auth.md` | Agent discovery: prose registration guide (auth.md slice 1) |
| `GET /.well-known/oauth-protected-resource` | Agent discovery: Protected Resource Metadata (RFC 9728 shape) |
| `GET /.well-known/oauth-authorization-server` | Agent discovery: Authorization Server metadata with `agent_auth` block |
| `POST /agent/auth` | auth.md registration alias for collection execution agents (admin Bearer; same storage as `/api/agent/registrations` plus scope metadata) |

## Stability

| Area | Notes |
|------|--------|
| Route paths and verbs | Treated as stable for integrations unless noted otherwise. |
| Ingestion metadata field names | Stable (`target_identifier`, etc.). |
| Compare drift structure | Stable top-level keys; finding `match_key` and title normalization may evolve with rules. |
| Full `AuditReport` and findings | Evolves with analyzer and LLM output; clients should tolerate unknown fields. |

## Routes

### `GET /api/health`

Runtime health snapshot for the currently configured app boot path.

Intended for:

- container or App Container health checks
- operator validation of storage and admin-token wiring
- confirming whether the app is using deterministic LLM fallback

**200:** app boot path is valid for the current storage selection.
**503:** runtime config is invalid for the selected storage driver.

**200 / 503 body:**

```json
{
  "ok": true,
  "service": "signalforge",
  "storage": {
    "driver": "sqlite",
    "status": "ok",
    "missing": []
  },
  "llm": {
    "provider": "openai",
    "status": "fallback"
  },
  "admin_api": {
    "status": "disabled"
  }
}
```

Notes:

- `storage.driver` follows the same normalized `DATABASE_DRIVER` selection semantics as runtime storage boot.
- unsupported `DATABASE_DRIVER` values return `storage.status: "error"` and `ok: false`.
- `llm.status: "fallback"` means SignalForge will continue with deterministic analysis when the configured LLM provider is unavailable or incomplete.
- `admin_api.status` reflects whether `SIGNALFORGE_ADMIN_TOKEN` is set and non-empty.

---

### `POST /api/runs`

Submit artifact content as JSON or multipart.

| | JSON body | Multipart (`multipart/form-data`) |
|---|-----------|-------------------------------------|
| **Required** | `content` (string) | `file` (upload) |
| **Common** | `filename`, `source_type`, `artifact_type` | `filename` from file name; optional `artifact_type`, `source_type` |
| **Optional (Phase 5a)** | Same keys as multipart fields | `target_identifier`, `source_label`, `collector_type`, `collector_version`, `collected_at` |

**200:** `PostRunsResponse` — `run_id`, `artifact_id`, `status`, `report` (parsed audit report).  
**400:** `{ "error": string, "code"?: string }` (validation). Includes `code: "unsupported_artifact_type"` when the supplied or inferred artifact family is not supported by this SignalForge build.  
**500:** `{ "error": string, "code"?: string }`

Currently supported artifact families:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

TypeScript: `PostRunsResponse` in `src/types/api-contract.ts`.  
Schema: `docs/schemas/post-runs-response.schema.json`, `docs/schemas/ingestion-metadata.schema.json`.

---

### `GET /api/runs`

List runs for dashboard or programmatic consumers.

**200:** `{ "runs": RunSummary[] }` — see `RunSummary` in `src/types/api.ts`.  
**500:** `{ "error": string }`

TypeScript: `GetRunsListResponse`. Schema: `docs/schemas/get-runs-list-response.schema.json`.

---

### `GET /api/runs/[id]`

Full run detail including embedded report JSON and ingestion metadata.

**200:** `GetRunDetailResponse` — includes `links.compare_ui` and `links.compare_api` (relative paths).  
**404:** `{ "error": "Run not found" }`  
**500:** `{ "error": string }`

Serialization: `toRunDetailJson()` in `src/lib/api/run-detail-json.ts`.  
TypeScript: `GetRunDetailResponse`. Schema: `docs/schemas/run-detail-response.schema.json` (report object summarized; full audit report shape lives in analyzer code).

---

### `GET /api/runs/[id]/report`

Raw audit report only, with no run wrapper.

**200:** Body is the `AuditReport` JSON object (not wrapped in `{ report: ... }`).  
**404:** `{ "error": "..." }` if run missing or no report.

TypeScript: `GetRunReportResponse` (= `AuditReport`).

---

### `GET /api/runs/[id]/compare`

Deterministic finding drift using the same logic as the UI compare page. No LLM.

**Query:** optional `against=<runId>` (baseline run).

**Implicit baseline (omit `against`):** the latest older run for the same logical target as the current run. That baseline is **not guaranteed** to be the reanalyze parent (`parent_run_id`) on a newer run. If you need an exact baseline, use `against=` explicitly.

**200:** `CompareDriftPayload` — `current`, `baseline`, `baseline_missing`, `target_mismatch`, `baseline_selection`, `against_requested`, `drift` (`summary` + `rows`), and `evidence_delta`.  
Each non-null run snapshot includes both `id` and `run_id` with the same UUID, so clients can use `run_id` consistently with `POST /api/runs` and `POST .../reanalyze` bodies.  
**400:** `against` equals current id.  
**404:** Run not found or explicit `against` not found.

TypeScript: `GetCompareResponse` in `src/types/api-contract.ts` (alias of `CompareDriftPayload` from `src/lib/compare/build-compare.ts`).  
Schema: `docs/schemas/compare-drift-response.schema.json`.

---

### `POST /api/runs/[id]/reanalyze`

Re-run the analyzer on the stored artifact for an existing run. This creates a new run row.

**200:** `PostReanalyzeResponse` — `run_id`, `artifact_id`, `parent_run_id`, `status` (no full `report` in body; use GET run/report).  
**404:** Run or artifact missing.  
**500:** `{ "error": string }`

TypeScript: `PostReanalyzeResponse`. Schema: `docs/schemas/post-reanalyze-response.schema.json`.

---

## Error Shape

Most errors use `{ "error": string, "code"?: string }`. Schema: `docs/schemas/error-response.schema.json`.

## CLI Helpers

- Submit: `scripts/analyze.sh`
- Read: `scripts/signalforge-read.sh` (`run` | `report` | `compare`)
- Automation-agent bootstrap and polling: `scripts/signalforge-automation-agent.sh` (`register` | `request` | `poll` | `wait`)
- Local end-to-end smoke: `scripts/smoke-automation-agent-local.sh` or `bun run smoke:automation-agent`

## Stability Guidance

Treat these as stable for current integrations:

- route paths and verbs listed here
- ingestion metadata field names
- top-level compare response keys
- `evidence_delta` field names when present

Treat these as evolving:

- detailed `AuditReport` contents
- finding titles and recommendations
- compare `match_key` normalization internals
- which family-specific metric rows appear inside `evidence_delta.metrics`

Clients should tolerate unknown fields.

## Typical Integration Flows

### Submit, then read the run

1. `POST /api/runs`
2. read `run_id` from the response
3. `GET /api/runs/[id]` or `GET /api/runs/[id]/report`

### Compare a run

1. `GET /api/runs/[id]/compare`
2. optionally add `?against=<runId>` when you need a fixed baseline

Successful compare responses always include finding drift plus deterministic `evidence_delta`.
`drift` remains the finding-level compatibility layer. `evidence_delta` covers:

- whether the underlying artifact bytes changed
- whether submission metadata changed
- stable aggregate metric deltas that are safe to compare without LLM logic

When no baseline exists, `baseline_missing` is `true` and `evidence_delta` is `null`.

### Reanalyze the same artifact

1. `POST /api/runs/[id]/reanalyze`
2. read the new `run_id`
3. fetch the new run or compare it against the previous run

### Phase 6c: register a source and request collection (operator)

All routes below require header `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>`.

**`POST /api/sources`** — JSON body: `display_name`, `target_identifier`, `source_type` (`linux_host` \| `wsl`), optional `expected_artifact_type` (default `linux-audit-log`; currently also supports `container-diagnostics` and `kubernetes-bundle`), `default_collector_type`, optional typed `default_collection_scope` (`linux_host` / `container_target` / `kubernetes_scope`) validated against `expected_artifact_type`, `capabilities`, `labels`, `enabled`.
**201:** source object. **400** validation, including `code: "unsupported_artifact_type"` when `expected_artifact_type` is not supported. **409** `duplicate_target_identifier`.

`source_type` is the execution host kind in v1, not a full evidence-target taxonomy. For container and Kubernetes sources, operators should read `expected_artifact_type` plus `default_collection_scope` as the durable description of what evidence the agent will collect.

**`GET /api/sources`** — **200:** `{ "sources": Source[] }`.

**`GET /api/sources/[id]`** — **200** source. **404** if missing.

**`PATCH /api/sources/[id]`** — partial JSON; **cannot** change `target_identifier`, `source_type`, `expected_artifact_type` in v1. Accepts `default_collection_scope` (or `null` to clear) with the same artifact-family validation as create. **200** source.

**`POST /api/sources/[id]/collection-jobs`** — optional JSON: `request_reason`, `priority`, `idempotency_key` (24h dedupe per source), and typed `collection_scope` (`linux_host` / `container_target` / `kubernetes_scope`). Scope shape must match `source.expected_artifact_type`; mismatch returns **400** `invalid_collection_scope`. **201** new job, **200** same job on idempotent replay. **409** `source_disabled`.

**`GET /api/sources/[id]/collection-jobs`** — optional `?status=`. Returns a read-model projection for expired leases (`claimed`→`queued`, `running`→`expired`) without mutating stored rows. Status filtering is applied after this projection. **200:** `{ "jobs": CollectionJob[] }`.

**`GET /api/collection-jobs/[id]`** — same lease read-model projection as list (no write-side reaper on this read path). **200** job. **404** if missing.

**`POST /api/collection-jobs/[id]/cancel`** — **200** cancelled job. **409** if `running` or already terminal.

**`POST /api/agent/registrations`** — JSON `{ "source_id", "display_name?" }`. **201:** `{ agent_id, source_id, token, token_prefix }` (plaintext `token` once). **409** if source already has a registration.

**Agent discovery (auth.md slice 1):** unauthenticated routes at the site root:

- **`GET /auth.md`** — Markdown prose guide; PRM is authoritative on conflict.
- **`GET /.well-known/oauth-protected-resource`** — JSON PRM with `resource_name`, `authorization_servers`, `scopes_supported`.
- **`GET /.well-known/oauth-authorization-server`** — JSON with `agent_auth.register_uri`, compatibility pointers, and `claim_implemented: false`.

Optional env: `SIGNALFORGE_PUBLIC_BASE_URL` overrides absolute URLs in discovery documents (useful behind reverse proxies).

**`POST /agent/auth`** — auth.md registration alias for **collection execution agents**. Same admin Bearer auth and storage as `POST /api/agent/registrations`. **201:** `{ agent_id, source_id, token, token_prefix, scopes, rotation_guidance, compatibility }`. Scopes are discovery metadata in slice 1; runtime jobs/next still gates on capability strings such as `collect:<artifact_type>`. **409** on duplicate enroll.

**`POST /api/automation-agent/registrations`** — JSON `{ "source_id", "display_name?" }`. **201:** `{ automation_agent_id, source_id, token, token_prefix }` (plaintext `token` once). **409** if source already has an automation-agent registration.

Errors are JSON `{ "error": string, "code"?: string }` unless noted.

### Phase 6d: agent execution (source-bound Bearer)

All routes below require `Authorization: Bearer <agent_token>` (from registrations). The agent poll/heartbeat control-plane routes (`GET /api/agent/jobs/next`, `POST /api/agent/heartbeat`) run a small **lease reaper** first: expired **claimed** leases → job **queued** again; expired **running** → terminal **`expired`** (not requeued).

**`POST /api/agent/heartbeat`** — JSON: `capabilities`, `attributes`, `agent_version`, optional `active_job_id`, optional `instance_id`. Updates registration caps, merges source `attributes`, sets source `last_seen_at` and `health_status=online`. **When `active_job_id` is set:** `instance_id` is **required** and must equal the job’s `lease_owner_instance_id`; job must be **claimed** or **running**, leased to this registration, lease not expired — otherwise **400** / **403** / **409** with explicit `code` (`instance_id_required`, `instance_mismatch`, `lease_expired`, etc.). Lease extension uses this **request** `instance_id` (not registration state alone). **401** if token invalid.

**200 body:** `{ "ok": true, "active_job_lease": null }` when no `active_job_id` was sent. When `active_job_id` was sent and preconditions passed: either `{ "ok": true, "active_job_lease": { "job_id", "extended": true, "lease_expires_at" } }` if the lease row was extended, or `{ "ok": true, "active_job_lease": { "job_id", "extended": false, "code": "lease_not_extended" } }` if the server did not apply an extension (e.g. concurrent lease change). Invalid active-job requests still yield **4xx** — they do not return `ok: true` with a hidden skip.

**`GET /api/agent/jobs/next`** — optional `?limit=` (default small) and optional `?wait_seconds=` (bounded long-poll; max 20s). **200:** `{ "jobs": JobSummary[], "gate": string | null }`. `JobSummary` always includes `collection_scope`; it is `null` when no scope was set at queue time. **Reject** `source_id` query with **400**. **Strict capability gating:** no successful heartbeat yet → `jobs: []`, `gate: "heartbeat_required"`. After heartbeat, **empty** capability list → `gate: "capabilities_empty"`. Otherwise each job requires `collect:<job.artifact_type>` in the intersection of (last heartbeated agent capabilities ∩ source `capabilities`). If queued jobs exist but none qualify → `gate: "capability_mismatch"`. When there are no queued rows, `gate` is **null**. Disabled source → `gate: "source_disabled"`. Long-poll waiting only applies when the initial result is `jobs: []` and `gate: null`; gate failures still return immediately.

**`POST /api/collection-jobs/{id}/claim`** — JSON `instance_id`, `lease_ttl_seconds` (clamped). Atomic **queued** → **claimed** (establishes lease instance). **403** wrong source. **409** if not queued / already claimed.

**`POST /api/collection-jobs/{id}/start`** — JSON **`instance_id` (required)** must match the job’s `lease_owner_instance_id`. **claimed** → **running**; refreshes run lease (~5m). **400** `instance_id_required`. **403** `instance_mismatch` or another agent holds the claim. **409** `lease_expired` / `invalid_transition` as before.

**`POST /api/collection-jobs/{id}/fail`** — JSON **`instance_id` (required)**, `code`, `message`. **claimed** or **running** → **failed** when lease and instance match. **400** `instance_id_required`. **403** `instance_mismatch`. **409** on lease/expiry or bad state.

**`POST /api/collection-jobs/{id}/artifact`** — `multipart/form-data` like `POST /api/runs` (file + optional ingestion fields). **`instance_id` is required:** form field `instance_id` **or** header `X-SignalForge-Agent-Instance-Id` (must match job lease). **400** `instance_id_required` / `file_required` / `unsupported_artifact_type`. **403** `instance_mismatch`. Target and collector defaults are **forced from the source**; `source_label` is `agent:<registration_id>`, `source_type` `agent`. Only from **running** with a matching lease. **409** `job_already_submitted` on duplicate completion and **409** `artifact_type_mismatch` when the upload family does not match the queued job’s `artifact_type`.

**Job vs run outcome:** The collection job **`status` stays `submitted`** once the artifact is stored and the run is created (ingest + analyze pipeline ran). **`result_analysis_status`** on the job (and **`run_status`** in the **200** JSON body) copies the linked run’s `status` (e.g. **`complete`** or **`error`**). Operators and agents should treat **`submitted` + `result_analysis_status: "error"`** as “delivered but analysis failed,” not a fully successful outcome.

Design reference: [`plans/phase-6b-source-job-api-contract.md`](../plans/phase-6b-source-job-api-contract.md).

### Automation-agent diagnostics (source-bound Bearer)

All routes below require `Authorization: Bearer <automation_agent_token>` from registrations.

**`POST /api/automation-agent/diagnostic-requests`** — optional JSON body:

- `request_reason?: string`
- `idempotency_key?: string`
- `trigger_signal_id?: string`

The token's bound source is always the target. The route does **not** accept `source_id`, `artifact_type`, or `collection_scope` overrides. SignalForge queues a normal `CollectionJob` for that source using its configured artifact family and default collection scope. **201** on insert or **200** on idempotent replay: `{ request_id, collection_job_id, source_id, status, poll_url }`.

When `trigger_signal_id` is provided, it must belong to the token's bound Source. The queued collection job stores that trigger and the signal moves to `diagnostic_requested`.

**`GET /api/automation-agent/diagnostic-requests/[id]`** — read a source-bound diagnostic request and its structured result envelope. **200:** `{ request, result }`.

- `request` includes job lifecycle fields such as `status`, timestamps, linked run or artifact ids, terminal error metadata, and `poll_url`
- `result` is `null` until a linked run exists
- once the job is `submitted` with a linked run, `result` includes:
  - `run_id`, `artifact_id`, `artifact_type`, `target_identifier`, run `status`
  - `severity_counts`
  - `summary`, `top_actions_now`, `findings`, and `environment_context`
  - `is_incomplete`, `incomplete_reason`, `analysis_error`
  - links to `run`, `report`, and `compare_api`

Lifecycle notes:

- `queued`, `claimed`, `running` → pending, `result: null`
- `submitted` + run `complete` → terminal success with populated `result`
- `submitted` + run `error` → terminal result with `analysis_error`
- `failed`, `cancelled`, `expired` → terminal failure with `result: null`

Cross-source reads with a valid automation-agent token return **403**.

### Autonomous Kubernetes actions

Autonomous action routes are source-bound and deterministic. They do not accept free-form commands or LLM-generated patches.

**`GET /api/automation-agent/signals/next?limit=10`** — returns open automation signals for the token's Source. `source_id` query is rejected. **200:** `{ signals: AutomationSignal[] }`.

**`POST /api/automation-agent/fix-action-runs`** — JSON `{ signal_id, diagnostic_request_id, pre_fix_run_id, idempotency_key? }`. The route validates source ownership, signal/request/run linkage, latest diagnostic state, `kubernetes-bundle`, Source opt-in, execution-agent `fix:kubernetes-safe` capability, and the deterministic allowlist. **201/200:** `{ action_run_id, source_id, status: "queued", policy_id, action_kind, action_payload, poll_url }`. **409** for stale, ineligible, or capability-mismatched requests.

**`GET /api/automation-agent/fix-action-runs/[id]`** — source-bound action status plus dry-run/apply/post-fix evidence.

Execution-agent routes:

- `GET /api/agent/fix-actions/next?limit=1` — source-bound queued fix actions; requires both Source and last heartbeat to include `fix:kubernetes-safe`; each action includes the exact deterministic `action_payload` with target workload, namespace, patch manifest, and changed fields.
- `POST /api/fix-action-runs/[id]/claim` — JSON `{ instance_id, lease_ttl_seconds? }`; same strict instance lease model as collection jobs.
- `POST /api/fix-action-runs/[id]/start` — claimed → `dry_running`.
- `POST /api/fix-action-runs/[id]/dry-run` — JSON `{ instance_id, status: "passed" | "failed", summary }`; failed dry-runs become terminal.
- `POST /api/fix-action-runs/[id]/apply` — JSON `{ instance_id, status: "applied" | "failed", summary }`; successful apply queues a post-fix collection job.

The first allowlisted policy is `kubernetes.disable-service-account-token-automount.v1`. It maps only the deterministic Kubernetes finding for automatic service-account token mounts to a server-side apply patch template. SignalForge marks the action `verified` only after post-fix diagnostics no longer contain the triggering finding.

## Related

- External submit (multipart/JSON fields): `docs/external-submit.md`
- Ingestion parsing/limits: `src/lib/ingestion/meta.ts`
- LLM provider env (OpenAI vs Azure endpoint styles): `README.md` — not part of the HTTP contract but affects analysis when the API routes invoke the analyzer.
