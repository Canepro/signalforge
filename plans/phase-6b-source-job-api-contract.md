# Phase 6b: Schema + API contract — Source, CollectionJob, thin agent

> **Status:** Design / contract only. **Not implemented.**  
> **Prerequisite:** [`phase-6-source-job-agent-architecture.md`](./phase-6-source-job-agent-architecture.md) (Phase 6a).  
> **Goal:** Freeze the **first implementation contract** for `Source`, `CollectionJob`, agent interaction, and the **internal event boundary** before DB migrations, routes, and UI work — so the next slice is low-churn.

**Rule:** No DB migrations or production routes in this pass unless a follow-on explicitly promotes this doc into `docs/api-contract.md` + code.

### Auth and trust boundaries (slice 1)

| Boundary | Mechanism | Scope |
|----------|-----------|--------|
| **Operator / admin** | Env **`SIGNALFORGE_ADMIN_TOKEN`** (long random secret). Requests send `Authorization: Bearer <token>`. | All **operator** routes: `POST`/`GET`/`PATCH` under `/api/sources`, `GET`/`POST` under `/api/sources/.../collection-jobs`, `GET` `/api/collection-jobs/{id}`, `POST` `.../cancel`, and **`POST /api/agent/registrations`**. |
| **Agent** | Per-enrollment secret returned once from registration; `Authorization: Bearer <agent_token>`. | `POST /api/agent/heartbeat`, `GET /api/agent/jobs/next`, and `claim` / `start` / `fail` / `artifact` on jobs **for the bound source only**. |

**Non-goals:** no users, sessions, OAuth, RBAC, or API keys per operator — this is **bootstrap / break-glass** auth so a network-exposed instance cannot mint jobs or agent credentials without the secret. Replace with real auth in a later phase.

**Deployment:** if `SIGNALFORGE_ADMIN_TOKEN` is unset, implementations should **fail operator routes** with `503` (misconfiguration) or refuse server start — document the chosen behavior; do not silently leave operator APIs open.

**Existing routes:** today’s **`POST /api/runs`** and other pre-phase-6 APIs stay on their current auth model until explicitly migrated; this doc only constrains the new operator + agent surfaces above.

---

## 1. Data model: `Source`

### 1.1 First-implementation fields

| Field | Type | Slice 1 | Required | Mutable after create | Notes |
|-------|------|---------|----------|----------------------|--------|
| `id` | UUID | yes | server | **immutable** | Primary key. |
| `display_name` | string 1–256 | yes | yes | **yes** | Operator label. |
| `target_identifier` | string 1–512 | yes | yes | **no** (v1) | Stable fleet key; must match run metadata for job-driven uploads. Changing it breaks compare semantics — defer “rename target” to later slice. |
| `source_type` | enum `linux_host` \| `wsl` | yes | yes | **no** (v1) | Drives validation of jobs/collectors. |
| `expected_artifact_type` | string | yes | yes | **no** (v1) | Slice 1: literal `linux-audit-log`. |
| `default_collector_type` | string | yes | yes | **yes** | Slice 1: `server-audit-kit`; rare edits only. |
| `default_collector_version` | string | yes | no | **yes** | Semver or opaque. |
| `capabilities` | string[] | yes | no (defaulted) | **yes** (operator) | If omitted at create, server sets e.g. `["collect:linux-audit-log"]` from `expected_artifact_type`. Agent must intersect this set to claim. |
| `attributes` | JSON object | yes | no | **agent/server merge** | Shallow merge on heartbeat; max ~8KB. Not authoritative for security. |
| `labels` | string→string | yes | no | **yes** | Max ~32 keys; organizational. |
| `enabled` | boolean | yes | yes (default true) | **yes** | When false, reject new jobs with `409` / `source_disabled`. |
| `last_seen_at` | timestamptz | yes | no | **server only** | Last successful agent heartbeat for this source. |
| `health_status` | enum | yes | yes (default `unknown`) | **server only** | `unknown` \| `online` \| `stale` \| `error`. Derived from heartbeats + optional job failure signals (later). |
| `created_at` | timestamptz | yes | server | **immutable** | |
| `updated_at` | timestamptz | yes | server | **server only** | |

### 1.2 Uniqueness (slice 1)

- **`target_identifier`:** unique among **enabled** sources (single-tenant v1). Create with duplicate → `409`.
- **`id`:** UUID unique globally.

### 1.3 What belongs on `Source` vs `Run` vs `Artifact`

| Concern | `Source` | `Artifact` | `Run` |
|---------|----------|------------|-------|
| Stable operator fleet key | `target_identifier` (declared) | — | `target_identifier` on submission (job path: **forced from Source**) |
| Evidence-derived hostname | — | — | `environment_context.hostname` in report JSON |
| Raw bytes / hash | — | `content`, `content_hash` | references `artifact_id` |
| Collector implementation for *this* evidence | defaults only | — | `collector_type`, `collector_version` (per submit) |
| Analysis results | — | — | embedded `report`, severity counts |
| “Who uploaded” | — | — | `source_type`, `source_label` (e.g. `agent`, `agent:<id>`) |

**Principle:** `Source` is **registration + capability + health**; never store full reports or large blobs on `Source`.

### 1.4 Deferred from slice 1

- Per-tenant scoping / multi-tenant uniqueness.
- Soft-delete vs hard-delete policy UI.
- Cached “last hostname seen” on Source for UX.
- Arbitrary JSON `metadata` beyond `labels` / `attributes` caps.

---

## 2. Data model: `CollectionJob`

### 2.1 First-implementation fields

| Field | Type | Slice 1 | Set by | Notes |
|-------|------|---------|--------|-------|
| `id` | UUID | yes | server | |
| `source_id` | UUID | yes | client (path) / implicit | FK → Source; must exist and be enabled. |
| `artifact_type` | string | yes | server | Copied from source `expected_artifact_type` on create (ignore client override in v1). |
| `status` | enum | yes | server | See §3. |
| `requested_by` | string ≤128 | yes | server | v1 literal `operator` or future `api:…`; not trusted identity yet. |
| `request_reason` | string ≤1024 | yes | client | Optional. |
| `priority` | int | optional | client | Default `0`; **ignored for ordering in slice 1** (FIFO by `created_at`). |
| `idempotency_key` | string ≤128 | optional | client | See §4. **Strongly recommended** for UI; treat as required for production agents once stable. |
| `lease_owner_id` | UUID | no | server | `AgentRegistration.id` of claiming agent. Nullable when not claimed. |
| `lease_owner_instance_id` | string ≤256 | no | server | Opaque from agent `claim.instance_id`. |
| `lease_expires_at` | timestamptz | no | server | Wall clock; see §4. |
| `last_heartbeat_at` | timestamptz | no | server | Last agent heartbeat **for this job** (while `claimed`/`running`). Distinct from `Source.last_seen_at`. |
| `result_artifact_id` | UUID | no | server | After successful persist. |
| `result_run_id` | UUID | no | server | After run row + analysis completes successfully. |
| `error_code` | string | no | server | Small enum §3. |
| `error_message` | string ≤2048 | no | server / agent | Human text on failure. |
| `created_at` | timestamptz | yes | server | |
| `updated_at` | timestamptz | yes | server | |
| `queued_at` | timestamptz | yes | server | When entering `queued`. |
| `claimed_at` | timestamptz | no | server | |
| `started_at` | timestamptz | no | server | Collector start (`running`). |
| `submitted_at` | timestamptz | no | server | Artifact accepted. |
| `finished_at` | timestamptz | no | server | Any terminal state. |

**Hardening later (not required in slice 1 schema):**

- `attempt_count` / max requeues before `expired`.
- `requested` visible to API (if split from `queued`).
- `last_progress_at` for upload staging.

### 2.2 Creation payload (operator)

**Client supplies:** optional `request_reason`, optional `priority`, optional `idempotency_key`.  
**Server sets:** `artifact_type`, `status` (→ `queued` immediately), `requested_by`, all timestamps for initial transition, `id`.

### 2.3 `AgentRegistration` (slice 1)

| Field | Notes |
|-------|--------|
| `id` | UUID; equals `lease_owner_id` / agent id in job lease fields. |
| `source_id` | **Required; unique in slice 1** — exactly **one** active registration row per source. Second `POST …/registrations` for same source → `409` unless a later slice adds revoke + re-enroll. |
| `token_hash` | Store hash of agent token server-side; never store plaintext after enrollment response. |
| `display_name?`, `created_at` | Optional operator label; audit. |

**Slice 1 rule:** one agent token **binds to exactly one `source_id`**. No multi-source agents, no `source_ids[]` on the token.

---

## 3. State machine / lifecycle (first slice)

**Canonical statuses:** `requested` | `queued` | `claimed` | `running` | `submitted` | `failed` | `cancelled` | `expired`

**API visibility (slice 1):** job create returns **`queued`** directly (internal `requested` optional and may be skipped).

### 3.1 Per-state definition

| State | Meaning | Entered by | Required fields / timestamps |
|-------|---------|------------|------------------------------|
| `requested` | Record created (optional internal) | Server on submit | `created_at`; next step immediate → `queued`. |
| `queued` | Waiting for agent | Create success | `queued_at`, clear `lease_*`, clear `last_heartbeat_at` for job. |
| `claimed` | Agent holds lease | Successful `claim` | `lease_owner_id`, `lease_owner_instance_id`, `lease_expires_at`, `claimed_at`. |
| `running` | Collector invoked | Successful `start` | `started_at`; refresh `lease_expires_at` if policy extends on start. |
| `submitted` | Artifact stored + run linked | Successful `artifact` | `result_artifact_id`, `result_run_id`, `submitted_at`, `finished_at`; clear lease fields. |
| `failed` | Terminal error | Agent `fail`, server validation, cancel policy | `error_code`, `error_message`, `finished_at`; clear lease. |
| `cancelled` | Operator abort | `cancel` | `error_code=cancelled` (recommended), `finished_at`; clear lease. |
| `expired` | Terminal: lease lost **while `running`** | Reaper | `finished_at`, `error_code=lease_lost` (or `agent_stalled` if distinguishing slow upload vs dead agent — pick one enum in implementation), `error_message` set; clear lease. **No automatic requeue** — operator creates a **new** job if retry needed. |

### 3.2 Allowed transitions (who / reject)

| From | To | Actor | Condition / reject |
|------|-----|--------|----------------------|
| — | `queued` | Server | Source enabled; valid `artifact_type`. Reject if source disabled. |
| `queued` | `claimed` | **Agent** `claim` | Atomic CAS on `queued`. Reject `409` if not `queued` or wrong source binding. |
| `claimed` | `running` | **Agent** `start` | Bearer matches `lease_owner_id` + instance; lease not expired. Else `403` / `409`. |
| `claimed` | `failed` | **Agent** `fail` | Same as above. |
| `claimed` | `cancelled` | **Operator** | Reject if not `claimed` (only `queued`/`claimed` per §5). |
| `running` | `submitted` | **Agent** `artifact` | Valid lease + multipart; reject `409` if already `submitted`. |
| `running` | `failed` | **Agent** `fail` | Valid lease. |
| `queued` | `cancelled` | **Operator** | |
| `queued` | `claimed` | — | **Invalid:** skip; only via claim. |
| `running` | `cancelled` | — | **Slice 1: reject** (no cancel while running) to avoid races with upload. |
| `submitted` / `failed` / `cancelled` / `expired` | *any* | — | **Reject** all mutations except idempotent read. |
| `claimed` | `queued` | **Server reaper** | **Only** when `lease_expires_at < now` **before** collector start — reclaim slot for same job. Clear `lease_owner_*`, `last_heartbeat_at`; emit `collection_job.lease_lost`. |
| `running` | `expired` | **Server reaper** | When `lease_expires_at < now` **after** `start` — **terminal**; do **not** requeue (avoids duplicate collections / duplicate runs while upload idempotency is immature). See §4.3. |

---

## 4. Lease and idempotency rules

### 4.1 Lease duration

- Agent proposes `lease_ttl_seconds` on **claim** (max **300** enforced server-side; min **60** optional).
- `lease_expires_at = now + ttl` at claim time.

### 4.2 Heartbeat extension

- Agent sends `POST /api/agent/heartbeat` with `active_job_id` = this job **only if** it still holds the lease (`lease_owner_id` matches authenticated agent, `lease_owner_instance_id` matches).
- Server sets `last_heartbeat_at` on the job and extends `lease_expires_at` by **`lease_extension_seconds`** (recommended **120**, cap total wall time **30m** optional later).
- If `active_job_id` omitted or wrong, job lease is **not** extended.

### 4.3 Expired lease (slice 1 — **asymmetric** by state)

| Current state | `lease_expires_at < now` | Next state | Rationale |
|---------------|--------------------------|------------|-------------|
| **`claimed`** | yes | **`queued`** | Agent never called `start` (crashed after claim, wrong job, etc.). Safe to put work back on the queue **without** having started the collector — no duplicate run risk yet. |
| **`running`** | yes | **`expired`** (terminal) | Collector was started; requeueing would risk **second collection** and **second run** while artifact completion idempotency is still thin (§4.5). Operator must **create a new job** to retry. |

**Reaper actions:**

- **`claimed` → `queued`:** clear `lease_owner_id`, `lease_owner_instance_id`, `lease_expires_at`, job `last_heartbeat_at`; set `updated_at`; emit **`collection_job.lease_lost`** (payload notes `requeued: true` or equivalent).
- **`running` → `expired`:** set `error_code` to **`lease_lost`** (recommended) or **`agent_stalled`** if product language prefers; set `error_message`, `finished_at`, clear lease fields; emit **`collection_job.expired`** (or `collection_job.failed` with `error_code` — pick one event name in implementation and stay consistent).

**Heartbeat:** agents **must** extend the lease while `running` during long collects/uploads; if extensions are insufficient, the job ends terminal — **by design** until stronger upload idempotency ships.

### 4.4 Duplicate claim protection

- **Claim** is single-winner **`UPDATE … WHERE status='queued' AND id=? AND source_id=?`** (bind `source_id` from token) **returning** row.
- Second caller (another process with the same token, or stale retry) gets **`409 Conflict`** with code `job_already_claimed`. **Slice 1 does not support** multiple concurrent workers per source.

### 4.5 Duplicate upload / complete

- **Second successful `artifact` POST** for same job id: return **`409`** with `code: job_already_submitted` and body includes existing `run_id` / `artifact_id` if safe (no secrets).
- **Idempotency-Key** on artifact upload (optional header): if same key replays within TTL, return same `200` response — **defer to slice 1.1** if complex; slice 1 can rely on `409` only.

### 4.6 Relationship to artifact hash dedupe

- Ingestion today may dedupe **artifacts** by `content_hash`; **two jobs could theoretically complete with same bytes**.
- **Contract:** each job may still reach `submitted` with a **run** row; if dedupe returns existing `artifact_id`, **new `run` row** is still created for this job (current product behavior: new run per submission). If product later collapses runs, that is a **breaking** contract change.
- Job `result_artifact_id` / `result_run_id` always reflect the rows produced **for this job’s upload attempt**.

### 4.7 Idempotency for job **create**

- **Strongly recommended** for UI (retry-safe): `idempotency_key` in body or `Idempotency-Key` header.
- **Server:** within **24h**, same `(source_id, idempotency_key)` returns **same job** with `200` or `201` + same `id`.
- **Slice 1:** implement if low cost; else document as **must-have before multi-tab UI**.

---

## 5. HTTP / API contract (first slice)

**Errors:** JSON `{ "error": string, "code"?: string }`.

**Authentication (normative):**

- **Operator:** `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>` on every route in the table below **except** none — all operator rows require it. Missing or wrong token → **`401`** (or **`403`** with opaque body; pick one and document).
- **Agent:** `Authorization: Bearer <agent_enrollment_token>`. Invalid/revoked token → **`401`**.

### 5.1 `GET /api/agent/jobs/next` — semantics (slice 1)

**Binding:** the agent token resolves to exactly one `AgentRegistration` and therefore one **`source_id`** (§2.3). The handler **never** accepts a client-supplied `source_id` query param for filtering in v1 (ignore or reject if present — **reject `400`** recommended to catch buggy agents early).

**Query:**

- `limit` — optional, default **`1`**, max **`10`** (enforced server-side). Number of job summaries to return.

**Selection (“next”):**

1. Let `S` = the token’s bound `source_id` (from `AgentRegistration`; **not** from query params).
2. Candidate set: `job.source_id = S` and `job.status = queued` (and source still **enabled** — if disabled, return **`200` `{ jobs: [] }`**).
3. **Capability filter (within this source only):** jobs are already for this source’s `expected_artifact_type`. If the server has a **last known** `capabilities` array from the agent’s most recent heartbeat, **optionally** exclude jobs unless `intersection(agent.capabilities, source.capabilities)` includes the collect capability for that artifact type (slice 1: e.g. `collect:linux-audit-log`). **If there is no heartbeat yet,** omit this filter (single artifact type v1; token possession is the gate) **or** return an empty list until first heartbeat — implementations choose one and document it.
4. Sort by **`created_at` ascending** (FIFO).
5. Return the first `limit` rows as **`CollectionJobSummary`** — **no mutation** (poll is read-only).

**Idempotency:** repeated polls return the **same** queued jobs until one is claimed (by this or another holder of the same token — slice 1 assumes **one process** per token).

**`CollectionJobSummary`:** `id`, `source_id`, `artifact_type`, `status`, `created_at` (and optional `request_reason`); no large nested objects.

### 5.2 Route table

| # | Method | Path | Caller | Slice 1 | Auth | Request | Success | Errors |
|---|--------|------|--------|---------|------|---------|---------|--------|
| S1 | `POST` | `/api/sources` | Operator | **yes** | Admin | `CreateSourceBody` | `201` + Source | `400`, `401`, `409` dup `target_identifier` |
| S2 | `GET` | `/api/sources` | Operator | **yes** | Admin | query `?enabled=` | `200` `{ sources }` | `401` |
| S3 | `GET` | `/api/sources/{id}` | Operator | **yes** | Admin | — | `200` Source | `401`, `404` |
| S4 | `PATCH` | `/api/sources/{id}` | Operator | **yes** | Admin | partial | `200` Source | `401`, `404`, `400` |
| J1 | `POST` | `/api/sources/{sourceId}/collection-jobs` | Operator | **yes** | Admin | `CreateCollectionJobBody` | `201` + Job | `401`, `404`, `409` disabled |
| J2 | `GET` | `/api/sources/{sourceId}/collection-jobs` | Operator | **yes** | Admin | query `status` optional | `200` `{ jobs }` | `401`, `404` |
| J3 | `GET` | `/api/collection-jobs/{jobId}` | Operator | **yes** | Admin | — | `200` Job | `401`, `404` |
| J4 | `POST` | `/api/collection-jobs/{jobId}/cancel` | Operator | **yes** | Admin | `{}` | `200` Job | `401`, `404`, `409` if `running` |
| A1 | `POST` | `/api/agent/registrations` | Operator | **yes** | Admin | `{ source_id, display_name? }` | `201` + token **once** | `401`, `404`, `409` source already has registration |
| A2 | `POST` | `/api/agent/heartbeat` | Agent | **yes** | Agent | `HeartbeatBody` | `200` | `401` |
| A3 | `GET` | `/api/agent/jobs/next` | Agent | **yes** | Agent | `?limit=` | `200` `{ jobs: summary[] }` | `401` |
| A4 | `POST` | `/api/collection-jobs/{jobId}/claim` | Agent | **yes** | Agent | `ClaimBody` | `200` Job | `401`, `403`, `404`, `409` |
| A5 | `POST` | `/api/collection-jobs/{jobId}/start` | Agent | **yes** | Agent | `{}` | `200` Job | `401`, `403`, `409` |
| A6 | `POST` | `/api/collection-jobs/{jobId}/fail` | Agent | **yes** | Agent | `{ code, message }` | `200` Job | `401`, `403` |
| A7 | `POST` | `/api/collection-jobs/{jobId}/artifact` | Agent | **yes** | Agent | multipart | `200` `{ job, run_id, artifact_id }` | `401`, `403`, `400`, `409` |

**`403` on agent job routes:** `job.source_id` ≠ token’s bound `source_id` (wrong id in URL — should not happen for honest agent with correct polling).

**Deferred (not slice 1):**

- `DELETE /api/sources/{id}`, agent revoke/rotate token UI, long-poll job wait, batch claim, admin metrics, **multi-source agent tokens**, requeue of **`running`** on lease loss.

---

## 6. Agent contract (thin external agent)

**Repository:** implement in a **separate** `signalforge-agent` repo (or `server-audit-kit` opt-in package) — **not** inside the Next.js server tree.

### 6.1 Enrollment (operator performs once)

1. Operator calls `POST /api/agent/registrations` with **`Authorization: Bearer <admin_token>`** and body `{ "source_id", "display_name?" }`.
2. Response: `{ "agent_id", "source_id", "token", "token_prefix" }` — **store `token` in agent config**; never logged again from server. **`source_id` is redundant with token but useful for UX;** the token is **only** valid for that source.
3. Second registration for the same `source_id` while a row exists → **`409`** (slice 1 — revoke/replace deferred).

### 6.2 Steady-state loop

1. **Heartbeat** every **30–60s** (configurable): `capabilities`, `attributes`, `agent_version`, `active_job_id` (nullable). Heartbeats **do not** send `source_id` — the server derives it from the token.
2. **Poll** `GET /api/agent/jobs/next?limit=1` — jobs are **only** for the token’s bound source (§5.1).
3. If job returned: **claim** → **start** → run **fixed** command path to `server-audit-kit` (e.g. `first-audit.sh`) → **artifact** multipart upload → on script non-zero exit, **fail**. **Extend lease** via heartbeat with `active_job_id` while collecting/uploading so `running` is not killed prematurely (§4.2).

### 6.3 Payload shapes (normative)

**HeartbeatBody**

```json
{
  "capabilities": ["collect:linux-audit-log", "upload:multipart"],
  "attributes": { "os": "linux", "arch": "amd64" },
  "agent_version": "0.1.0",
  "active_job_id": "<uuid | null>"
}
```

**ClaimBody**

```json
{
  "instance_id": "<opaque stable per process>",
  "lease_ttl_seconds": 300
}
```

**FailBody**

```json
{
  "code": "collector_failed",
  "message": "first-audit.sh exited 1"
}
```

**Artifact upload:** same multipart fields as [`docs/external-submit.md`](../docs/external-submit.md); server sets `target_identifier` from Source.

### 6.4 Identity / token use

| Action | Header |
|--------|--------|
| Source/job operator APIs, agent registration | `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>` |
| Heartbeat, poll, claim, start, fail, artifact | `Authorization: Bearer <agent enrollment token>` |

Agent token maps to **`AgentRegistration`** with **exactly one `source_id`**; `agent_id` = registration `id`. **Multi-source agents are out of scope for slice 1.**

### 6.5 What belongs in `signalforge-agent` (separate repo)

- Enrollment file / env wiring, heartbeat + poll loop, claim/start/fail/artifact calls, backoff, **fixed** collector invocation, logging.
- **Not** in this repo: admin token handling (operator CLI or dashboard only), job creation UI, SQLite, ingestion pipeline.

### 6.6 Errors and retries

- **`401`:** stop loop; operator must re-enroll or fix token (agent) or set `SIGNALFORGE_ADMIN_TOKEN` (operator).
- **`409` on claim:** another worker won the lease (e.g. duplicate process with same token — discouraged); poll again.
- **`409` on artifact:** job already submitted; treat as success and exit loop for that job.
- **Terminal `expired` (`lease_lost`):** do not retry the same job; operator creates a **new** job if a fresh collect is needed.
- **Network errors:** exponential backoff to poll/heartbeat; do not spin tight.

### 6.7 Local config (agent)

- `SIGNALFORGE_BASE_URL`
- `SIGNALFORGE_AGENT_TOKEN` (binds to one `source_id` server-side)
- `SIGNALFORGE_SOURCE_ID` (optional **mirror** for local logging only — **not** sent to authenticate poll scope in v1)
- Path to `server-audit-kit` checkout

---

## 7. Event boundary (domain events, no sinks yet)

Emit internally (bus, log, or `events` table) — **no** Slack, Rocket.Chat, Teams, or webhooks in slice 1. See roadmap “notifications” phases.

| Event | Trigger | Core payload fields |
|-------|---------|---------------------|
| `source.registered` | `POST /api/sources` persisted | `source_id`, `target_identifier`, `source_type`, `occurred_at` |
| `source.health_changed` | Heartbeat or reaper updates `health_status` or `last_seen_at` | `source_id`, `previous_health`, `health_status`, `occurred_at` |
| `collection_job.requested` | Job reaches `queued` (after create) | `job_id`, `source_id`, `artifact_type`, `occurred_at` |
| `collection_job.claimed` | `queued` → `claimed` | `job_id`, `lease_owner_id`, `lease_expires_at`, `occurred_at` |
| `collection_job.running` | `claimed` → `running` | `job_id`, `occurred_at` |
| `collection_job.submitted` | `running` → `submitted` | `job_id`, `artifact_id`, `run_id`, `occurred_at` |
| `collection_job.failed` | → `failed` | `job_id`, `error_code`, `error_message`, `occurred_at` |
| `collection_job.cancelled` | → `cancelled` | `job_id`, `occurred_at` |
| `collection_job.lease_lost` | Reaper: `claimed` → `queued` (lease expired **before** `start`) | `job_id`, `source_id`, `requeued: true`, `occurred_at` |
| `collection_job.expired` | Reaper: `running` → `expired` (lease lost **after** `start`) | `job_id`, `source_id`, `error_code` (`lease_lost` / `agent_stalled`), `occurred_at` |
| `run.created` | Run row inserted (including job upload path) | `run_id`, `artifact_id`, `source_id?`, `job_id?`, `occurred_at` |
| `run.completed` | Analysis finished successfully (report stored) | `run_id`, `job_id?`, `occurred_at` |
| `run.failed` | Ingestion or analysis could not produce a complete report (pipeline error) | `run_id`, `error` summary, `job_id?`, `occurred_at` |

**Throttle:** `source.health_changed` and `agent.heartbeat` (if emitted) should be debounced (e.g. ≥60s between duplicate health events per source).

---

## 8. First implementation slice (exact scope)

**In:**

- **`SIGNALFORGE_ADMIN_TOKEN`** set in deployment; all operator APIs (sources, jobs, agent registration) require **`Authorization: Bearer`** with that value.
- One **`Source`** type: `linux_host` or `wsl`; `expected_artifact_type=linux-audit-log`.
- One **`CollectionJob`** path: operator creates job → agent claim → start → artifact → `submitted` + `run_id`.
- **Exactly one `AgentRegistration` (and one agent token) per source**; agent poll/claim/upload **only** for that `source_id`.
- One **agent process** per source (running that token — duplicate processes are unsupported / race-prone).
- UI: operator supplies admin token via **server-side config** or **secure operator-only channel** (do not embed in public client bundles). Flows: create/list/get/patch source; **Collect Fresh Evidence** → `POST …/collection-jobs` → poll job status → link to `/runs/{id}`.
- **Reaper:** `claimed` + expired lease → **`queued`**; **`running`** + expired lease → **`expired`** terminal (**no** requeue). Operator retries by **creating a new job**.
- Internal emission of §7 events (can be `console` + TODO bus in slice 1).

**Out:**

- Multi-source agents, **unauthenticated operator APIs**, automatic **`running` → `queued`** recovery, priority queues, cancel while running, Windows/macOS/K8s, scheduler, notification providers, token rotation / revoke UI, fleet dashboards, generic collector plugins, `PATCH target_identifier`, second registration for same source without deleting the first.

---

## 9. Guardrails / non-goals

- **No** dashboard-triggered SSH, kubectl, or docker exec against customer infra.
- **No** collectors implemented inside the SignalForge server process.
- **No** generalized collector framework or plugin marketplace before this vertical works.
- **No** broad fleet-management or inventory product in slice 1.
- **No** Slack / Rocket.Chat / Teams / webhook delivery — only **domain events** reserved for later consumers.
- Notifications remain **event-driven** and **downstream** of job/run lifecycle.
- **`SIGNALFORGE_ADMIN_TOKEN` is not** multi-user auth, SSO, audit identity, or rotation policy — it is a **single shared bootstrap secret** to be replaced by proper auth later. Do not log it; rotate by redeploy.
- **No** leaving new operator or registration routes **unauthenticated** when the env token is set.

---

## 10. Recommendation

### 10.1 Minimal route set (implement in this order)

1. **Admin auth middleware** (`SIGNALFORGE_ADMIN_TOKEN`) on all operator routes in §5.2.  
2. `POST/GET/PATCH /api/sources` (+ `GET` by id)  
3. `POST/GET /api/sources/{id}/collection-jobs` + `GET /api/collection-jobs/{id}`  
4. `POST /api/agent/registrations` (admin-auth; **unique `source_id`**)  
5. Agent auth middleware (agent token → `source_id`) + `POST /api/agent/heartbeat` + `GET /api/agent/jobs/next` (§5.1 semantics)  
6. `POST …/claim`, `…/start`, `…/fail`, `…/artifact` (**403** if job not for token’s source)  
7. `POST …/cancel` + background reaper (**asymmetric** lease expiry §4.3)  
8. Wire UI (admin token **not** in public bundles) + emit §7 events

### 10.2 Minimal schema

- Tables: **`sources`**, **`collection_jobs`**, **`agent_registrations`** (or equivalent names).  
- **`agent_registrations.source_id` unique** (slice 1 — one token per source).  
- Lease + heartbeat on **`collection_jobs`** only (no `agent_leases` table in v1).

### 10.3 First implementation order

Schema migration → repository helpers → operator source + job APIs → agent registration → agent authenticated routes → claim/start/artifact/fail → reaper → UI Collect button → reference agent repo.

---

## References

- Phase 6a: [`phase-6-source-job-agent-architecture.md`](./phase-6-source-job-agent-architecture.md) — **lease / requeue:** Phase 6a’s “stale lease → `queued`” text is **refined here** for **`running`** (terminal `expired`, §4.3).  
- Phase 5 boundary: [`phase-5-collector-architecture.md`](./phase-5-collector-architecture.md)  
- Ingestion: [`docs/external-submit.md`](../docs/external-submit.md)  
- Existing HTTP: [`docs/api-contract.md`](../docs/api-contract.md)

---

## 11. Open questions (implementation)

- **Admin token in the dashboard:** prefer **server-side API routes** that attach the token from env (BFF) vs operator pasting a secret — pick one pattern before exposing Phase 6 UI on the public internet.
- **`401` vs `403` for wrong admin token:** pick consistent semantics across routes.
- **Capability gate before first heartbeat (§5.1):** empty poll vs permissive poll — document the chosen behavior in `docs/api-contract.md` when promoting this spec.
- **`expired` vs `failed` for running lease loss:** this doc uses status **`expired`** with `error_code=lease_lost`; align UI copy and metrics.
