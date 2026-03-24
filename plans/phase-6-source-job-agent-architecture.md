# Phase 6a: Source registration + CollectionJob + thin external agent

> **Status:** Architecture / design only. **Not implemented.**  
> **Builds on:** [`phase-5-collector-architecture.md`](./phase-5-collector-architecture.md) (fresh evidence boundary, metadata envelope, security stance).  
> **Does not replace:** Today’s **`POST /api/runs`** contract — jobs and agents are an *additional* path that still ends in the same ingestion + analysis pipeline.

---

## Executive summary

SignalForge evolves from **manual collect → manual submit** to **click “Collect Fresh Evidence” → control plane creates work → thin agent executes near the target → artifact upload → analysis → job linked to run**.

| Plane | Owns |
|-------|------|
| **SignalForge (control plane)** | `Source` registry, `CollectionJob` lifecycle, APIs, UI triggers, tokens/scopes for enrollment and upload, linking job → `artifact_id` / `run_id`. |
| **Thin external agent (execution plane)** | Enrollment identity, polling/claiming jobs, running **existing** collectors (e.g. `signalforge-collectors`), local sudo/OS access, uploading bytes + metadata back. |

SignalForge **does not** become an SSH executor, kubectl runner, or RMM platform. Execution and privilege stay **on or beside the target**, inside a small agent process the operator deploys deliberately.

**Inspiration (patterns, not copy-paste):**

- **Grafana Fleet / Alloy** — registration, attributes, health, remote intent without the collector being the control plane.
- **osquery / FleetDM** — enrollment, stable node identity, poll/claim, result writeback.
- **Argo CD** — scoped registration, least privilege, crisp trust boundaries between components.

**Preferred implementation shape:** a **SignalForge-specific thin agent** that speaks a narrow job API, wrapping **reuse** of `signalforge-collectors` (or similar) for artifact bytes — not a greenfield collector framework and not adopting a full RMM stack as the core model.

---

## 1. Source model

### 1.1 Purpose

A **`Source`** is a **registered intent** that says: “this logical target may produce evidence of type X via agent Y.” It is the anchor for **Collect Fresh Evidence** and for **matching jobs to agents** (capability + identity), not a duplicate of every run.

### 1.2 Proposed fields (logical schema)

| Field | Type / notes | Rationale |
|-------|----------------|-----------|
| **`id`** | UUID (server-generated) | Stable primary key in SignalForge. |
| **`display_name`** | string | Operator-facing label (“Prod web-01”, “Vincent laptop WSL”). |
| **`target_identifier`** | string, required, unique per tenant later | Aligns with today’s run metadata; canonical compare key when set. Same value should appear on uploaded runs from this source. |
| **`source_type`** | enum, e.g. `linux_host`, `wsl` (slice 1) | Drives which collectors and agent capabilities are valid. |
| **`expected_artifact_type`** | e.g. `linux-audit-log` | Matches adapter registry; job requests this explicitly. |
| **`default_collector_type`** | string, e.g. `signalforge-collectors` | Hint for agent selection and UX. |
| **`default_collector_version`** | string (semver or opaque) | Display + compatibility checks; agent may override at runtime. |
| **`attributes`** | key/value map (string keys, scalar or small JSON) | **Fleet/Alloy-style**: OS version, arch, region, “has_sudo”, etc. Filled by agent at registration/heartbeat. Not a dump of full inventory. |
| **`capabilities`** | string set, e.g. `collect:linux-audit-log`, `upload:multipart` | **Claim matching**: job requests must intersect agent capabilities. |
| **`labels`** | key/value (organizational) | Optional; for UI filters — not used for security decisions alone. |
| **`enabled`** | boolean | Disable new jobs without deleting history. |
| **`created_at` / `updated_at`** | timestamps | Audit. |
| **`last_seen_at`** | timestamp, nullable | Last successful agent heartbeat tied to this source. |
| **`health_status`** | enum, e.g. `unknown`, `online`, `stale`, `error` | Derived from heartbeats + last job outcome (UX + alerting later). |

### 1.3 Source vs run (what lives where)

| Concern | **Source** | **Run** (today + future) |
|---------|------------|---------------------------|
| Stable fleet key | **`target_identifier`** (declared at registration) | **`target_identifier`** on run (from submission metadata) — should **match** source when job-driven. |
| Evidence-derived hostname | optional cache on source (from last report) | **`environment_context.hostname`** in report JSON — **authoritative for that artifact**. |
| Collector implementation | defaults + capability hints | **`collector_type`**, **`collector_version`** on run (per submission). |
| “Who uploaded” | N/A (registration is separate) | **`source_label`**, **`source_type`** (`api`, `upload`, future `agent`) |
| Artifact bytes / hash | N/A | **`artifacts`** row |
| Analysis outcome | N/A | **`runs`** + embedded report |

**Principle:** Source is **inventory + capability**; Run is **evidence + analysis**. Do not store large blobs or full reports on Source.

---

## 2. CollectionRequest / CollectionJob model

### 2.1 Naming

- **`CollectionJob`** — concrete unit of work in the queue (implementation-facing).  
- **`CollectionRequest`** — optional alias for the user-visible “I asked for a collect” record; **v1 can collapse to a single `CollectionJob` table** with a `requested_by` field. This doc uses **CollectionJob** unless UX needs a separate request id.

### 2.2 Lifecycle states

| State | Meaning |
|-------|---------|
| **`requested`** | Created by UI/API; validated (source exists, enabled). |
| **`queued`** | Eligible for agents to claim (default transition from requested). |
| **`claimed`** | One agent holds a lease; no other agent should claim the same job. |
| **`running`** | Agent reports execution started (collector invoked). |
| **`submitted`** | Artifact received; ingestion started or completed; **`artifact_id`** / **`run_id`** set. |
| **`failed`** | Terminal: agent or server recorded error (with code/message). |
| **`cancelled`** | Terminal: user or system aborted before submit. |
| **`expired`** | Terminal: TTL elapsed while `queued` or `claimed` without progress. |

Optional substates (later): **`uploading`**, **`analyzing`** if upload and analyze are split for UX.

### 2.3 Proposed fields (logical schema)

| Field | Notes |
|-------|--------|
| **`id`** | UUID |
| **`source_id`** | FK → Source |
| **`artifact_type`** | e.g. `linux-audit-log` (must match source expectations or explicit override policy) |
| **`status`** | enum above |
| **`requested_by`** | opaque string or future user id (`ui:session`, `api:key-…`) — **v1 can be literal `operator`** |
| **`request_reason`** | optional string (“pre-deploy check”, “drift investigation”) |
| **`priority`** | optional int (default 0) — defer fancy scheduling |
| **`created_at`**, **`updated_at`** | timestamps |
| **`queued_at`**, **`claimed_at`**, **`started_at`**, **`submitted_at`**, **`finished_at`** | nullable lifecycle timestamps |
| **`lease_owner_id`** | agent instance id while claimed/running |
| **`lease_expires_at`** | heartbeat extends; stale lease handling (**`claimed` vs `running`**) is **normative in Phase 6b** [`phase-6b-source-job-api-contract.md`](./phase-6b-source-job-api-contract.md) §4.3 — `running` does **not** auto-requeue in v1. |
| **`last_heartbeat_at`** | from agent during running |
| **`result_artifact_id`** | set when upload accepted |
| **`result_run_id`** | set after analysis run row created (may equal synchronous ingest) |
| **`error_code`**, **`error_message`** | on failed/expired/cancelled |
| **`idempotency_key`** | optional; client-supplied to avoid duplicate jobs on retry |

### 2.4 Transitions (happy path)

```text
requested → queued → claimed → running → submitted
```

**Failure paths:** any active state → `failed` or `expired`; `queued`/`claimed` → `cancelled`.

### 2.5 Linking to ingestion

- Agent uploads via **the same multipart contract** as today (`POST /api/runs`) **plus** a **job binding**:
  - e.g. header `X-SignalForge-Collection-Job-Id` + short-lived **upload token**, or
  - dedicated `POST /api/collection-jobs/{id}/artifact` that internally creates artifact + run and attaches ids to the job.

**Recommendation for slice 1:** dedicated **job-complete upload** route that reuses ingestion helpers but **requires** a scoped token proving claim on `job_id`. Avoid duplicating analyzer logic.

---

## 3. Thin external agent model

### 3.1 Responsibilities

1. **Enroll** with SignalForge (one-time or periodic re-enrollment) → receive **`agent_id`**, **`source_id`** mapping or claim list, and **credentials** (token or mTLS later).
2. **Advertise** **capabilities** and **attributes** (heartbeat).
3. **Poll** (or long-poll) for work: `GET /api/agent/.../jobs?capabilities=...`.
4. **Claim** a job: `POST .../jobs/{id}/claim` with lease TTL.
5. **Execute** collector locally (e.g. run `first-audit.sh` or equivalent from `signalforge-collectors`).
6. **Upload** artifact + metadata; receive `run_id`.
7. **Acknowledge** job complete or failure.

### 3.2 Agent identity

- **`agent_id`**: stable UUID assigned at enrollment (stored server-side).
- **`agent_instance_id`**: optional per-process id for leases (host+pid or random) to distinguish restarts.

### 3.3 Transport patterns

| Pattern | Pros | Cons |
|---------|------|------|
| **Short poll** | Simple, works everywhere | Latency, chatter |
| **Long poll** | Fewer requests | Timeouts, proxies |
| **Webhook callback** | Instant | Agent must be reachable inbound — **avoid for v1** on laptops |

**Slice 1:** HTTPS **short poll** with exponential backoff cap; **long poll** as optional optimization.

### 3.4 Heartbeats

- Agent sends **heartbeat** every *N* seconds with:
  - `agent_id`, optional `source_id`s managed, **capabilities**, **attributes**, **version** of agent binary.
- Server updates **`Source.last_seen_at`**, **`health_status`**, and extends **job lease** if a job is active.

### 3.5 Failure handling and retries

- **Transient failures** (disk full, network blip): agent may **retry upload** with same **`idempotency_key`**; server dedupes artifact hash as today.
- **Lease expiry**: job returns to **`queued`** if lease stale; **idempotent claim** must tolerate duplicate artifact (hash dedup).
- **Collector failure**: agent sets job **`failed`** with message; operator may re-request.

### 3.6 Local configuration

Minimal config file or env:

- `SIGNALFORGE_BASE_URL`
- `SIGNALFORGE_AGENT_TOKEN` (or enrollment bootstrap token → exchange for refresh token)
- `SIGNALFORGE_SOURCE_ID` or enrollment payload that binds agent → source(s)
- Path to `signalforge-collectors` or bundled scripts

### 3.7 Repo boundaries

| Component | Repo |
|-----------|------|
| Job + Source APIs, DB schema, UI | **signalforge** |
| Reference collector scripts | **signalforge-collectors** (reuse) |
| Thin agent binary / installer | **new repo** `signalforge-agent` (recommended) or `signalforge-collectors` opt-in subpackage — **not** inside Next.js server code |

Keeping the agent **outside** the web app repo preserves release cadence, permissions model, and avoids coupling agent security reviews to UI deploys.

---

## 4. Security boundary

### 4.1 Why SignalForge must not hold broad SSH/kube credentials

- Compromise of the web tier must not yield **remote execution** on customer networks.
- Storing cluster-admin kubeconfigs or fleet SSH keys centralizes **catastrophic** blast radius.

### 4.2 Why execution stays near the target

- **sudo**, host paths, and local policy are **already** on the machine or in the operator’s trust zone.
- The agent runs with **explicit** OS permissions the operator granted — same trust model as “I ran first-audit.sh myself.”

### 4.3 Least privilege

- **Enrollment token:** narrow scope — “register one agent” or “bind to source X”; short TTL; one-time use where possible.
- **Job claim token:** scoped to **`job_id`** + **`agent_id`** + lease window.
- **Upload token:** scoped to **`job_id`** only; can only complete **that** job’s artifact pipe.

### 4.4 Deferred (explicit)

- Full multi-tenant RBAC, per-source ACL matrices, OAuth for agents, mTLS mesh, HSM-backed keys.
- **Push from SignalForge to agent** without polling (inbound agent connectivity).
- **Secrets injection** from SignalForge into agent (prefer agent uses **local** identity only).
- **Scheduled** fleet-wide collection policies (cron in product).

---

## 5. First vertical slice (only)

**Scope:**

1. **Linux / WSL** source type only.
2. **Artifact:** `linux-audit-log` from **`signalforge-collectors`** (`first-audit.sh` or file capture equivalent).
3. **One** thin agent process (single source per agent instance is acceptable in v1).
4. **One** UI path: **Collect Fresh Evidence** on a source detail view (or minimal modal from dashboard) → creates **one** `CollectionJob`.
5. **One** lifecycle implemented end-to-end: `queued` → `claimed` → `running` → `submitted` (or `failed`).

**Explicitly out of slice 1:**

- Windows, macOS, Kubernetes, containers, multi-source agents, fleet scheduling, arbitrary plugin collectors, RMM features.

---

## 6. Reuse vs build

| Item | Reuse | Build (SignalForge-specific) |
|------|-------|------------------------------|
| Audit bytes + script behavior | **`signalforge-collectors`** | thin wrapper invocation only in agent |
| Artifact upload shape | Existing **`POST /api/runs`** fields (`target_identifier`, `collector_*`, `collected_at`) | **Job-bound upload** route + tokens |
| Registration / health | Inspired by Fleet/Alloy | minimal **Source** + **heartbeat** API |
| Poll / claim | Inspired by FleetDM / job queues | **CollectionJob** state machine + lease |
| Scoped trust | Inspired by Argo CD app/project model | **token scopes** per enrollment and per job |

**Why a custom agent:** Generic agents (e.g. raw osquery) do not natively speak SignalForge job IDs or produce **`linux-audit-log`** bundles in the required shape. A **thin** dedicated agent minimizes scope while keeping the protocol stable.

---

## 7. Delivery sequence (after this design)

1. **Lock logical schema** for `Source` + `CollectionJob` (this doc + review).
2. **API and data contract (Phase 6b):** [`phase-6b-source-job-api-contract.md`](./phase-6b-source-job-api-contract.md) — freeze routes, fields, state machine, minimal UI slice, internal events **before** coding.
3. **Thin agent contract** (same doc or `docs/agent-contract.md`): headers, auth, error codes, idempotency.
4. **DB migration + minimal routes** in SignalForge (no UI yet) behind feature flag if needed.
5. **Reference agent** (separate repo): poll, claim, run kit, upload, ack.
6. **UI:** wire **Collect Fresh Evidence** to job creation + status display + link to resulting run.
7. **Hardening:** lease edge cases, token rotation, operator docs.
8. **Only then:** second collector type or multi-platform sources.

---

## 8. Risks and guardrails

| Risk | Guardrail |
|------|-----------|
| Privileged automation blob | No arbitrary command execution from SignalForge; agent runs **fixed** collector entrypoints. |
| Dashboard → host execution | Dashboard only creates **jobs**; agent pulls work. |
| Fleet-management sprawl | **One source / one job type** until slice works; no org-wide policy UI in v1. |
| Collector framework before one vertical works | **No** plugin SDK until `signalforge-collectors` path is boringly reliable. |
| Overcomplicated auth | **Bearer tokens** with scope tables before OAuth/OIDC for agents. |
| Duplicate target truth | **`target_identifier`** on Source and on Run must be reconciled in UI if drift detected (future rule: job submission **forces** source’s identifier into metadata). |

---

## 9. Relationship to Phase 5 doc

[`phase-5-collector-architecture.md`](./phase-5-collector-architecture.md) remains valid for **push-first** and **metadata envelope**. Phase 6a **adds**:

- persistent **Source** registry,
- **job** state machine,
- **agent** protocol,

without moving collectors into the Next.js process. When implementation starts, **update §7–10 of Phase 5** to reference this doc as the **execution orchestration** layer and adjust “first vertical slice” language to match §5 above.

---

## References (repo)

- Next contract gate: [`phase-6b-source-job-api-contract.md`](./phase-6b-source-job-api-contract.md)
- Ingestion metadata: [`docs/external-submit.md`](../docs/external-submit.md)
- HTTP surface today: [`docs/api-contract.md`](../docs/api-contract.md)
- Compare / target logic: `src/lib/db/repository.ts`, `src/lib/target-identity.ts`
- Collector reference: [Canepro/signalforge-collectors](https://github.com/Canepro/signalforge-collectors)
