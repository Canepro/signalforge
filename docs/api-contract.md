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

**Unexpected server failures (selected JSON routes):** **500** responses use a stable body **`{ "error": "Internal server error", "code": "internal_error" }`** without echoing raw exception text. Operators should inspect server logs for the underlying failure.

## Quick Route Guide

| Route | Use it for |
|---|---|
| `POST /api/runs` | Submit new evidence |
| `GET /api/runs` | List known runs |
| `GET /api/runs/[id]` | Read a run and its stored report |
| `GET /api/runs/[id]/report` | Read raw report JSON only |
| `GET /api/runs/[id]/compare` | Read deterministic drift between runs |
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
| `POST /api/agent/heartbeat` | Agent: capabilities, attributes, lease extension for active job |
| `GET /api/agent/jobs/next` | Agent: next **queued** jobs for bound source (optional `limit`; **no** `source_id` query) |
| `POST /api/collection-jobs/[id]/claim` | Agent: `queued` → `claimed` |
| `POST /api/collection-jobs/[id]/start` | Agent: `claimed` → `running` |
| `POST /api/collection-jobs/[id]/fail` | Agent: `claimed` \| `running` → `failed` |
| `POST /api/collection-jobs/[id]/artifact` | Agent: multipart artifact → same ingestion/analyzer path as `POST /api/runs`; job → **submitted** |

## Stability

| Area | Notes |
|------|--------|
| Route paths and verbs | Treated as stable for integrations unless noted otherwise. |
| Ingestion metadata field names | Stable (`target_identifier`, etc.). |
| Compare drift structure | Stable top-level keys; finding `match_key` and title normalization may evolve with rules. |
| Full `AuditReport` and findings | Evolves with analyzer and LLM output; clients should tolerate unknown fields. |

## Routes

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

**200:** `CompareDriftPayload` — `current`, `baseline`, `baseline_missing`, `target_mismatch`, `baseline_selection`, `against_requested`, `drift` (`summary` + `rows`).  
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

## Stability Guidance

Treat these as stable for current integrations:

- route paths and verbs listed here
- ingestion metadata field names
- top-level compare response keys

Treat these as evolving:

- detailed `AuditReport` contents
- finding titles and recommendations
- compare `match_key` normalization internals

Clients should tolerate unknown fields.

## Typical Integration Flows

### Submit, then read the run

1. `POST /api/runs`
2. read `run_id` from the response
3. `GET /api/runs/[id]` or `GET /api/runs/[id]/report`

### Compare a run

1. `GET /api/runs/[id]/compare`
2. optionally add `?against=<runId>` when you need a fixed baseline

### Reanalyze the same artifact

1. `POST /api/runs/[id]/reanalyze`
2. read the new `run_id`
3. fetch the new run or compare it against the previous run

### Phase 6c: register a source and request collection (operator)

All routes below require header `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>`.

**`POST /api/sources`** — JSON body: `display_name`, `target_identifier`, `source_type` (`linux_host` \| `wsl`), optional `expected_artifact_type` (default `linux-audit-log`), `default_collector_type`, `capabilities`, `labels`, `enabled`.  
**201:** source object. **400** validation, including `code: "unsupported_artifact_type"` when `expected_artifact_type` is not supported. **409** `duplicate_target_identifier`.

**`GET /api/sources`** — **200:** `{ "sources": Source[] }`.

**`GET /api/sources/[id]`** — **200** source. **404** if missing.

**`PATCH /api/sources/[id]`** — partial JSON; **cannot** change `target_identifier`, `source_type`, `expected_artifact_type` in v1. **200** source.

**`POST /api/sources/[id]/collection-jobs`** — optional JSON: `request_reason`, `priority`, `idempotency_key` (24h dedupe per source). **201** new job, **200** same job on idempotent replay. **409** `source_disabled`.

**`GET /api/sources/[id]/collection-jobs`** — optional `?status=`. Runs a small **lease reaper** before listing. **200:** `{ "jobs": CollectionJob[] }`.

**`GET /api/collection-jobs/[id]`** — reaper runs first. **200** job. **404** if missing.

**`POST /api/collection-jobs/[id]/cancel`** — **200** cancelled job. **409** if `running` or already terminal.

**`POST /api/agent/registrations`** — JSON `{ "source_id", "display_name?" }`. **201:** `{ agent_id, source_id, token, token_prefix }` (plaintext `token` once). **409** if source already has a registration.

Errors are JSON `{ "error": string, "code"?: string }` unless noted.

### Phase 6d: agent execution (source-bound Bearer)

All routes below require `Authorization: Bearer <agent_token>` (from registrations). A small **lease reaper** runs on these requests (same as operator job reads): expired **claimed** leases → job **queued** again; expired **running** → terminal **`expired`** (not requeued).

**`POST /api/agent/heartbeat`** — JSON: `capabilities`, `attributes`, `agent_version`, optional `active_job_id`, optional `instance_id`. Updates registration caps, merges source `attributes`, sets source `last_seen_at` and `health_status=online`. **When `active_job_id` is set:** `instance_id` is **required** and must equal the job’s `lease_owner_instance_id`; job must be **claimed** or **running**, leased to this registration, lease not expired — otherwise **400** / **403** / **409** with explicit `code` (`instance_id_required`, `instance_mismatch`, `lease_expired`, etc.). Lease extension uses this **request** `instance_id` (not registration state alone). **401** if token invalid.

**200 body:** `{ "ok": true, "active_job_lease": null }` when no `active_job_id` was sent. When `active_job_id` was sent and preconditions passed: either `{ "ok": true, "active_job_lease": { "job_id", "extended": true, "lease_expires_at" } }` if the lease row was extended, or `{ "ok": true, "active_job_lease": { "job_id", "extended": false, "code": "lease_not_extended" } }` if the server did not apply an extension (e.g. concurrent lease change). Invalid active-job requests still yield **4xx** — they do not return `ok: true` with a hidden skip.

**`GET /api/agent/jobs/next`** — optional `?limit=` (default small) and optional `?wait_seconds=` (bounded long-poll; max 20s). **200:** `{ "jobs": JobSummary[], "gate": string | null }`. **Reject** `source_id` query with **400**. **Strict capability gating:** no successful heartbeat yet → `jobs: []`, `gate: "heartbeat_required"`. After heartbeat, **empty** capability list → `gate: "capabilities_empty"`. Otherwise each job requires `collect:<job.artifact_type>` in the intersection of (last heartbeated agent capabilities ∩ source `capabilities`). If queued jobs exist but none qualify → `gate: "capability_mismatch"`. When there are no queued rows, `gate` is **null**. Disabled source → `gate: "source_disabled"`. Long-poll waiting only applies when the initial result is `jobs: []` and `gate: null`; gate failures still return immediately.

**`POST /api/collection-jobs/{id}/claim`** — JSON `instance_id`, `lease_ttl_seconds` (clamped). Atomic **queued** → **claimed** (establishes lease instance). **403** wrong source. **409** if not queued / already claimed.

**`POST /api/collection-jobs/{id}/start`** — JSON **`instance_id` (required)** must match the job’s `lease_owner_instance_id`. **claimed** → **running**; refreshes run lease (~5m). **400** `instance_id_required`. **403** `instance_mismatch` or another agent holds the claim. **409** `lease_expired` / `invalid_transition` as before.

**`POST /api/collection-jobs/{id}/fail`** — JSON **`instance_id` (required)**, `code`, `message`. **claimed** or **running** → **failed** when lease and instance match. **400** `instance_id_required`. **403** `instance_mismatch`. **409** on lease/expiry or bad state.

**`POST /api/collection-jobs/{id}/artifact`** — `multipart/form-data` like `POST /api/runs` (file + optional ingestion fields). **`instance_id` is required:** form field `instance_id` **or** header `X-SignalForge-Agent-Instance-Id` (must match job lease). **400** `instance_id_required` / `file_required` / `unsupported_artifact_type`. **403** `instance_mismatch`. Target and collector defaults are **forced from the source**; `source_label` is `agent:<registration_id>`, `source_type` `agent`. Only from **running** with a matching lease. **409** `job_already_submitted` on duplicate completion and **409** `artifact_type_mismatch` when the upload family does not match the queued job’s `artifact_type`.

**Job vs run outcome:** The collection job **`status` stays `submitted`** once the artifact is stored and the run is created (ingest + analyze pipeline ran). **`result_analysis_status`** on the job (and **`run_status`** in the **200** JSON body) copies the linked run’s `status` (e.g. **`complete`** or **`error`**). Operators and agents should treat **`submitted` + `result_analysis_status: "error"`** as “delivered but analysis failed,” not a fully successful outcome.

Design reference: [`plans/phase-6b-source-job-api-contract.md`](../plans/phase-6b-source-job-api-contract.md).

## Related

- External submit (multipart/JSON fields): `docs/external-submit.md`
- Ingestion parsing/limits: `src/lib/ingestion/meta.ts`
- LLM provider env (OpenAI vs Azure endpoint styles): `README.md` — not part of the HTTP contract but affects analysis when the API routes invoke the analyzer.
