# Phase 5: Fresh evidence & collector architecture (planning)

> **Status:** Design / planning only. **Not implemented.** Phases 1a–4c remain the shipped baseline. This document is the agreed direction for how SignalForge should evolve toward external collection and fresh-evidence workflows without turning the product into a privileged automation platform.

---

## 1. Product boundary

### What SignalForge should own

- **Ingestion and storage** of evidence artifacts (bytes + minimal submission metadata).
- **Analysis:** deterministic adapters, environment detection, findings, LLM explanation, reports.
- **Persistence and presentation:** runs, artifacts, compare/drift, dashboard and API as today.
- **Later:** explicit **contracts** for how collectors label submissions (metadata envelope), not the collectors themselves.

### What SignalForge should not own (early model)

- **Live collection** on target hosts (no SSH, no kubectl, no “run audit script” inside SignalForge).
- **Broad infrastructure credentials** for customer systems (see §5).
- **A general remote execution engine** (“run this command everywhere”) — that is a different product class.

### What stays external

- **Collectors** (scripts, agents, cron jobs, CI steps) that run **on or near** the target and produce artifact files or streams. The reference today is **`signalforge-collectors`** in its own repo: it produces artifacts; SignalForge consumes them.

**Shipped UX (no boundary change):** SignalForge may show **Collect externally** / **How to collect** UI and richer CLI output so operators copy the right `SIGNALFORGE_URL` and submit commands. That is documentation-in-product, not in-app collection.

### Why this boundary matters

- **Security:** analysis services should not be a high-value pivot for lateral movement. Keeping collection out-of-process limits blast radius.
- **Operability:** operators already have patterns for running scripts with sudo, scheduled jobs, or golden images. SignalForge should **compose** with those, not replace them.
- **Clarity:** “we analyze what you send” is a crisp contract. “we can reach your fleet” introduces trust, RBAC, networking, and compliance scope SignalForge is not built for in v1 of this evolution.

**Position:** SignalForge **analyzes evidence**; **collectors gather evidence**; **collection remains external**. SignalForge may **orchestrate requests** in a later phase (e.g. “please collect” tokens, signed URLs, queue entries), but it must **not** become a **general privileged execution engine** for arbitrary infrastructure.

---

## 2. Fresh evidence vs reanalysis vs compare

These must stay **separate mental models** and **separate operations** in the product.

| Action | Operates on | Creates | User mental model |
|--------|-------------|---------|-------------------|
| **Reanalyze** | Existing **stored artifact** (immutable bytes) | New **run** row (`parent_run_id` → prior run), same `artifact_id` | “Run the current analyzer/LLM again on the same evidence.” Good for pipeline upgrades, model changes, or reproducing a report. |
| **Collect fresh evidence** | **Target environment** (outside SignalForge) | New **artifact** (new content, new hash) + new **run** | “Capture a new snapshot of the host, then analyze it.” Evidence changed; drift vs old runs is meaningful at artifact level. |
| **Compare** | Two **runs** (reports), optionally constrained by **target** | No new rows; read-only diff | “What changed between these two analyses?” Uses deterministic finding match keys today. |

**Data flow summary**

- **Reanalyze:** `artifact_id` unchanged → new run only.
- **Fresh collect:** new bytes → new `artifact_id` (unless deduped by hash from an identical upload) → new run.
- **Compare:** links two `run_id`s; baseline selection prefers **same target (hostname)** + prior run when available (`findPreviousRunForSameTarget` in `src/lib/db/repository.ts`).

**UI today:** “Collect Fresh Evidence” is **deferred** (muted/disabled) because there is no in-product trigger — users run collectors manually and **upload** or **CLI-submit** the new file. Phase 5 is about making that path **first-class in design** before coding new surfaces.

---

## 3. Target identity model

### How “target” works today (heuristic)

- **Hostname** is parsed from the analyzed artifact’s environment (`environment_context.hostname` from the `linux-audit-log` adapter) and stored on the run (via report JSON / list queries).
- **Compare** uses **normalized hostname** + **same `artifact_type`** to find a **previous run for the same target** when choosing a baseline. If hostname is missing, it **falls back to same-artifact** history.

This is **evidence-derived**, not a registered inventory identity.

### How SignalForge should think about “target” going forward

| Concept | Meaning | Stable? |
|---------|---------|--------|
| **Hostname (evidence)** | What the audit log claims (`SYSTEM IDENTITY`). | **Fragile** (renames, DHCP, containers). Good for UX, not a primary key alone. |
| **Target identifier (future)** | Operator-chosen or collector-provided stable id, e.g. `fleet:prod:web-01` or a UUID minted at enroll time. | **Designed** to be stable; requires explicit metadata. |
| **Source label** | Human-readable name for where the submission came from (“CI job”, “laptop”, “bastion upload”). | Display + filtering; not necessarily unique. |
| **Collector label** | Which collector implementation produced the bytes (`signalforge-collectors`, `sf-collector-linux-v1`, etc.). | Versioning and support; helps debugging. |

**Recommendation:** keep **hostname** as the **default operator-visible target** for compare and dashboards until explicit registration exists. Introduce a **optional `target_identifier`** (or `target_key`) in submission metadata **before** building fleet features — even if the first value is simply copied from hostname or manually set by the uploader.

**Heuristic vs explicit:** Today is **artifact-only + hostname heuristic**. Phase 5 implementation should add **explicit target metadata** only when the **ingestion contract** is defined; avoid pretending hostname is a fleet ID.

---

## 4. Collector model (design only)

### Modes to compare

| Mode | Description | Pros | Cons |
|------|-------------|------|------|
| **Push** | Collector runs on target; **uploads** artifact to SignalForge (HTTP POST, CLI, CI). | Simple; no inbound connectivity to customer networks; SignalForge stays a receiver. | Requires outbound path from target or a bastion; large files need resumable upload eventually. |
| **Pull** | SignalForge or a **broker** asks an agent to run and return a bundle. | Central trigger; good for “collect now”. | Implies long-lived agents, auth, and often **privileged** network paths — high scope. |
| **Hybrid** | Push by default; **signed URLs** or **queue jobs** for “requested collection” without holding SSH keys in SignalForge. | Balances ops and security. | More moving parts (tokens, expiry, idempotency). |

### Position for SignalForge

**Prefer push-first (and CLI/bastion-mediated push)** as the **first** collector integration story:

- Aligns with current **POST /api/runs** and **`scripts/analyze.sh`**.
- Avoids storing customer SSH/kube credentials in the app.
- A **hybrid** “collect request” can later mean: SignalForge issues a **one-time upload token** or **webhook callback**, still **without** executing commands on hosts.

Pull-based remote execution remains **deferred** until there is a **separate agent** with its own threat model — not the core web app.

### Best-practice direction for the next step

SignalForge should not jump directly from "manual external submit" to "dashboard runs commands everywhere."

The preferred next architecture is:

- **SignalForge = control plane**
- **thin external agent = execution plane**

That agent should:

- enroll or register with a stable identity
- advertise capabilities or attributes
- poll or claim collection work
- execute collectors locally or near the target
- upload artifacts back through the existing ingestion contract

This is intentionally closer to:

- **Grafana Fleet / Alloy** for collector registration, attributes, health, and remote intent
- **osquery / FleetDM** for enrollment, polling, node identity, and result writeback
- **Argo CD** for scoped registration and least-privilege trust boundaries

It is intentionally **not**:

- a full RMM platform
- a broad remote execution engine
- dashboard-driven SSH or kubectl from the web app

### Reuse vs greenfield

SignalForge should prefer:

1. **reusing patterns** from existing open-source agent systems
2. **reusing external collectors** where practical
3. a **small SignalForge-specific agent** only where the existing tools do not fit the artifact model cleanly

This is a middle path between:

- building a full collector/orchestration platform from scratch
- adopting a large general-purpose RMM stack too early

For the current product shape, a thin SignalForge-specific agent is likely the cleanest long-term fit if click-to-collect becomes a shipped workflow.

---

## 5. Security boundary

### Why SignalForge should not hold broad infra credentials (early)

- Dashboard compromise must not equal **fleet compromise**.
- Auditors and compliance teams will ask where secrets live; “in the Next.js app” is the wrong answer for SSH keys and cloud provider tokens with wide scope.

### Where privileged access should live

- **On the target** (collector script with local sudo), **or**
- **In the operator’s CI/CD** or **bastion** that already has access patterns, **or**
- **In a dedicated agent** (future) with its own identity, rotation, and scope — **not** inlined into SignalForge’s deployment.

### Acceptable later orchestration (not v1 of Phase 5)

- **Opaque tokens:** SignalForge issues “upload this run here” URLs with short TTL.
- **Signed attestations:** collector proves version + target metadata without SignalForge executing shell.
- **Read-only integration** with an existing secret store for **server-side** collectors only if a separate microservice owns the blast radius.

### How this differs from “agent with SSH/kubectl/docker access”

That model couples **execution** and **analysis**. SignalForge should remain **analysis-centric**: collectors produce **evidence blobs**; the app never runs `kubectl` against customer clusters in the request path.

---

## 6. Source registration and metadata

### What exists today (concrete)

| Field | Where | Notes |
|-------|--------|------|
| `artifact_type` | `artifacts` table, API | e.g. `linux-audit-log`; drives adapter selection. |
| `source_type` | `artifacts`, `runs` | e.g. `upload`, `api`; distinguishes UI vs API vs future values. |
| `filename` | per run / artifact row | Submission label. |
| `content_hash` | artifacts | Deduplication. |
| `created_at` | artifacts, runs | Ingestion / run time. |
| `parent_run_id` | runs | Reanalyze chain. |
| `environment_context` | inside report JSON on run | Includes `hostname`, `os`, `is_wsl`, etc. |

### Phase 5a (implemented): optional ingestion columns on `runs`

| Field | Purpose |
|-------|---------|
| `target_identifier` | Optional stable key from collector/operator (nullable). |
| `source_label` | Optional human label for the submission (nullable). |
| `collector_type` | Optional implementation id (nullable). |
| `collector_version` | Optional version string (nullable). |
| `collected_at` | Optional ISO 8601 time when evidence was captured on the host (nullable). |

Accepted on `POST /api/runs` (JSON or multipart form fields); **reanalyze** copies these from the parent run. `analyzed_at` remains **run `created_at`** unless promoted later. The **`scripts/analyze.sh`** helper can send the same fields via flags or `SIGNALFORGE_*` env vars; see **`docs/external-submit.md`** (Phase 5c).

### What may be added later

| Field | Purpose |
|-------|---------|
| `analyzed_at` | Explicit column if distinct from `created_at` is needed in API. |
| Broader **source registration** | Inventory / fleet UI — not in Phase 5a. |

**Principle:** avoid stuffing opaque JSON into `source_type` long-term; use explicit nullable columns as above.

---

## 7. Trigger model

| Trigger | Status today | Notes |
|---------|----------------|------|
| Manual upload (UI) | **Shipped** | Multipart `POST /api/runs`. |
| CLI submit | **Shipped** | `scripts/analyze.sh`. |
| Reanalyze | **Shipped** | `POST /api/runs/[id]/reanalyze`. |
| Collect fresh evidence | **Product intent; UI deferred** | User runs external collector, then upload/CLI — same as today until API/orchestration exists. |
| Scheduled collector push | **Future** | Cron/systemd on host POSTs on interval; no SignalForge scheduler required initially. |
| Integrated automation / agent caller | **Future** | CI job, chatops, internal platform — all map to **push** with metadata. |

**Orchestration triggers** (“please collect”) are **Phase 5+ implementation** items, after metadata and security story are fixed.

### Likely future trigger sequence

1. User clicks **Collect Fresh Evidence**
2. SignalForge creates a `CollectionRequest` / `CollectionJob`
3. A matching external agent polls or claims the job
4. The agent runs the appropriate collector locally
5. The agent uploads the resulting artifact and metadata
6. SignalForge analyzes the artifact and links the new run back to the job

---

## 8. Delivery sequence (realistic order after Phase 4c)

1. **Planning + metadata envelope** — freeze the fields in §6 for v1 of “collector submission” (document + OpenAPI-style description; no code required in this step beyond docs).
2. **Optional compare/export hardening** — small improvements that help when artifacts multiply (same target, different hashes).
3. **Fresh-evidence API contract** — e.g. optional headers or JSON body for `collector_version`, `collected_at`, `target_identifier`; backward compatible with current uploads.
4. **Reference collector design** — document how `signalforge-collectors` (or a thin wrapper) should tag runs; no requirement to fork heavy logic into SignalForge.
5. **Experimental collector path** — one end-to-end push (manual schedule + POST) with versioned metadata **before** any “click collect in UI” that implies server-side execution.

This is intentionally **not** a long roadmap dump: each step gates the next.

---

## 9. Risks and guardrails

- **No privileged automation blob:** the app must not accumulate “run anything” capabilities under one deployment.
- **No dashboard-driven SSH/kubectl to customer infra** in the early model.
- **No multi-collector platform sprawl** before one collector path is documented and tested.
- **No collector implementation** in SignalForge until the **contract** (metadata + auth + upload) is agreed — implementation belongs beside or outside the repo first (`signalforge-collectors` pattern).

---

## 10. Recommendation

### What SignalForge should do next

1. Treat **`plans/phase-5-collector-architecture.md`** as the **draft product contract** for fresh evidence.
2. Socialize the **push-first** collector model and **metadata envelope** with anyone building collectors.
3. Keep **findings quality** and **compare** strong — fresh evidence multiplies runs; diff noise hurts trust.
4. Next planning slice should define:
   - `Source`
   - `CollectionRequest` / `CollectionJob`
   - thin external agent responsibilities
   - capability matching and job lifecycle

### What should remain deferred

- In-app remote execution and fleet-wide “collect now” that requires stored credentials.
- Pull-model agents co-located with the web server without a separate security review.
- Full **source registration** / inventory product.

### First vertical slice when implementation eventually starts

**Thin-agent vertical slice:** registered Linux/WSL source → user clicks **Collect Fresh Evidence** → SignalForge creates a collection job → external agent runs `signalforge-collectors` locally → agent uploads artifact with metadata → same analysis pipeline → job links to resulting run. **No** direct execution surface inside SignalForge beyond job creation and artifact acceptance.

---

## References (repo)

- Current shipped plan: `plans/current-plan.md`
- Artifact / run schema (today): `src/lib/db/client.ts`, `src/lib/db/repository.ts`
- Compare baseline logic: `findPreviousRunForSameTarget`, `findPreviousRunForSameArtifact`
- External collector repo (boundary): `signalforge-collectors` (see `README.md`)
