import type { Database } from "sql.js";
import { createHash, randomBytes, randomUUID } from "crypto";
import { normalizeTargetIdentifier } from "../target-identity";
import { emitDomainEvent } from "../domain-events";

export type SourceType = "linux_host" | "wsl";
export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "submitted"
  | "failed"
  | "cancelled"
  | "expired";

export interface SourceRow {
  id: string;
  display_name: string;
  target_identifier: string;
  source_type: string;
  expected_artifact_type: string;
  default_collector_type: string;
  default_collector_version: string | null;
  capabilities_json: string;
  attributes_json: string;
  labels_json: string;
  enabled: number;
  last_seen_at: string | null;
  health_status: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionJobRow {
  id: string;
  source_id: string;
  artifact_type: string;
  status: string;
  requested_by: string;
  request_reason: string | null;
  priority: number;
  idempotency_key: string | null;
  lease_owner_id: string | null;
  lease_owner_instance_id: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  result_artifact_id: string | null;
  result_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  claimed_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  finished_at: string | null;
  /** Run `status` after artifact submit (`complete` \| `error`, …). Null for jobs not yet submitted or legacy rows. */
  result_analysis_status?: string | null;
}

export interface AgentRegistrationRow {
  id: string;
  source_id: string;
  token_hash: string;
  display_name: string | null;
  created_at: string;
  /** Last reported agent capabilities JSON array (for jobs/next filter). */
  last_capabilities_json?: string;
  last_heartbeat_at?: string | null;
  last_agent_version?: string | null;
  /** Set on successful claim — used to validate heartbeat lease extension. */
  last_instance_id?: string | null;
}

function allRows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

function getOne<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const obj = stmt.getAsObject() as unknown as T;
    stmt.free();
    return obj;
  }
  stmt.free();
  return null;
}

export function hashAgentToken(plainToken: string): string {
  return createHash("sha256").update(plainToken, "utf8").digest("hex");
}

export function generateAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

const DEFAULT_COLLECT = "collect:linux-audit-log";

export function defaultCapabilitiesForArtifactType(expectedArtifactType: string): string[] {
  if (expectedArtifactType === "linux-audit-log") return [DEFAULT_COLLECT];
  return [];
}

export interface CreateSourceInput {
  display_name: string;
  target_identifier: string;
  source_type: SourceType;
  expected_artifact_type?: string;
  default_collector_type?: string;
  default_collector_version?: string | null;
  capabilities?: string[];
  attributes?: Record<string, unknown>;
  labels?: Record<string, string>;
  enabled?: boolean;
}

export function insertSource(db: Database, input: CreateSourceInput): SourceRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  const expected = input.expected_artifact_type ?? "linux-audit-log";
  const caps =
    input.capabilities?.length ?
      input.capabilities
    : defaultCapabilitiesForArtifactType(expected);
  const targetNorm = normalizeTargetIdentifier(input.target_identifier);
  if (!targetNorm) {
    throw new Error("target_identifier is required");
  }
  const storedTarget = input.target_identifier.trim();

  db.run(
    `INSERT INTO sources (
      id, display_name, target_identifier, source_type, expected_artifact_type,
      default_collector_type, default_collector_version,
      capabilities_json, attributes_json, labels_json, enabled,
      last_seen_at, health_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unknown', ?, ?)`,
    [
      id,
      input.display_name.trim(),
      storedTarget,
      input.source_type,
      expected,
      input.default_collector_type ?? "signalforge-collectors",
      input.default_collector_version ?? null,
      JSON.stringify(caps),
      JSON.stringify(input.attributes ?? {}),
      JSON.stringify(input.labels ?? {}),
      input.enabled === false ? 0 : 1,
      now,
      now,
    ]
  );

  const row = getOne<SourceRow>(db, "SELECT * FROM sources WHERE id = ?", [id])!;
  emitDomainEvent("source.registered", {
    source_id: row.id,
    target_identifier: row.target_identifier,
    source_type: row.source_type,
    occurred_at: now,
  });
  return row;
}

export function getSourceById(db: Database, id: string): SourceRow | null {
  return getOne<SourceRow>(db, "SELECT * FROM sources WHERE id = ?", [id]);
}

export function listSources(db: Database, opts?: { enabled?: boolean }): SourceRow[] {
  if (opts?.enabled === true) {
    return allRows<SourceRow>(
      db,
      "SELECT * FROM sources WHERE enabled = 1 ORDER BY created_at DESC",
      []
    );
  }
  if (opts?.enabled === false) {
    return allRows<SourceRow>(
      db,
      "SELECT * FROM sources WHERE enabled = 0 ORDER BY created_at DESC",
      []
    );
  }
  return allRows<SourceRow>(db, "SELECT * FROM sources ORDER BY created_at DESC", []);
}

export interface PatchSourceInput {
  display_name?: string;
  default_collector_type?: string;
  default_collector_version?: string | null;
  capabilities?: string[];
  labels?: Record<string, string>;
  attributes?: Record<string, unknown>;
  enabled?: boolean;
}

export function updateSource(db: Database, id: string, patch: PatchSourceInput): SourceRow | null {
  const row = getSourceById(db, id);
  if (!row) return null;
  const now = new Date().toISOString();

  let display_name = row.display_name;
  let default_collector_type = row.default_collector_type;
  let default_collector_version = row.default_collector_version;
  let capabilities_json = row.capabilities_json;
  let labels_json = row.labels_json;
  let attributes_json = row.attributes_json;
  let enabled = row.enabled;

  if (patch.display_name !== undefined) display_name = patch.display_name.trim();
  if (patch.default_collector_type !== undefined)
    default_collector_type = patch.default_collector_type.trim();
  if (patch.default_collector_version !== undefined)
    default_collector_version = patch.default_collector_version;
  if (patch.capabilities !== undefined) capabilities_json = JSON.stringify(patch.capabilities);
  if (patch.labels !== undefined) labels_json = JSON.stringify(patch.labels);
  if (patch.attributes !== undefined) {
    try {
      const prev = JSON.parse(row.attributes_json || "{}") as Record<string, unknown>;
      attributes_json = JSON.stringify({ ...prev, ...patch.attributes });
    } catch {
      attributes_json = JSON.stringify(patch.attributes);
    }
  }
  if (patch.enabled !== undefined) enabled = patch.enabled ? 1 : 0;

  db.run(
    `UPDATE sources SET
      display_name = ?, default_collector_type = ?, default_collector_version = ?,
      capabilities_json = ?, labels_json = ?, attributes_json = ?, enabled = ?, updated_at = ?
    WHERE id = ?`,
    [
      display_name,
      default_collector_type,
      default_collector_version,
      capabilities_json,
      labels_json,
      attributes_json,
      enabled,
      now,
      id,
    ]
  );

  return getSourceById(db, id);
}

export interface CreateCollectionJobInput {
  request_reason?: string | null;
  priority?: number;
  idempotency_key?: string | null;
}

export function findRecentJobByIdempotencyKey(
  db: Database,
  sourceId: string,
  idempotencyKey: string,
  withinMs: number
): CollectionJobRow | null {
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  return getOne<CollectionJobRow>(
    db,
    `SELECT * FROM collection_jobs
     WHERE source_id = ? AND idempotency_key = ? AND created_at >= ?
     ORDER BY created_at DESC LIMIT 1`,
    [sourceId, idempotencyKey, cutoff]
  );
}

export function insertCollectionJob(
  db: Database,
  source: SourceRow,
  input: CreateCollectionJobInput
): { row: CollectionJobRow; inserted: boolean } {
  if (!source.enabled) {
    const err = new Error("source_disabled");
    (err as Error & { code: string }).code = "source_disabled";
    throw err;
  }

  if (input.idempotency_key?.trim()) {
    const existing = findRecentJobByIdempotencyKey(
      db,
      source.id,
      input.idempotency_key.trim(),
      24 * 60 * 60 * 1000
    );
    if (existing) return { row: existing, inserted: false };
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const artifactType = source.expected_artifact_type;

  db.run(
    `INSERT INTO collection_jobs (
      id, source_id, artifact_type, status, requested_by, request_reason, priority,
      idempotency_key, lease_owner_id, lease_owner_instance_id, lease_expires_at, last_heartbeat_at,
      result_artifact_id, result_run_id, error_code, error_message,
      created_at, updated_at, queued_at, claimed_at, started_at, submitted_at, finished_at
    ) VALUES (?, ?, ?, 'queued', 'operator', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    [
      id,
      source.id,
      artifactType,
      input.request_reason?.trim() ?? null,
      input.priority ?? 0,
      input.idempotency_key?.trim() ?? null,
      now,
      now,
      now,
    ]
  );

  const row = getOne<CollectionJobRow>(db, "SELECT * FROM collection_jobs WHERE id = ?", [id])!;
  emitDomainEvent("collection_job.requested", {
    job_id: row.id,
    source_id: row.source_id,
    artifact_type: row.artifact_type,
    occurred_at: now,
  });
  return { row, inserted: true };
}

export function listCollectionJobsForSource(
  db: Database,
  sourceId: string,
  opts?: { status?: string }
): CollectionJobRow[] {
  if (opts?.status) {
    return allRows<CollectionJobRow>(
      db,
      `SELECT * FROM collection_jobs WHERE source_id = ? AND status = ? ORDER BY created_at DESC`,
      [sourceId, opts.status]
    );
  }
  return allRows<CollectionJobRow>(
    db,
    `SELECT * FROM collection_jobs WHERE source_id = ? ORDER BY created_at DESC`,
    [sourceId]
  );
}

export function getCollectionJobById(db: Database, id: string): CollectionJobRow | null {
  return getOne<CollectionJobRow>(db, "SELECT * FROM collection_jobs WHERE id = ?", [id]);
}

export function cancelCollectionJob(db: Database, jobId: string): CollectionJobRow | null {
  const job = getCollectionJobById(db, jobId);
  if (!job) return null;
  if (job.status === "running") {
    const err = new Error("invalid_state");
    (err as Error & { code: string }).code = "cannot_cancel_running";
    throw err;
  }
  if (["submitted", "failed", "cancelled", "expired"].includes(job.status)) {
    const err = new Error("terminal");
    (err as Error & { code: string }).code = "already_terminal";
    throw err;
  }

  const now = new Date().toISOString();
  db.run(
    `UPDATE collection_jobs SET
      status = 'cancelled', error_code = 'cancelled', error_message = 'Cancelled by operator',
      finished_at = ?, updated_at = ?,
      lease_owner_id = NULL, lease_owner_instance_id = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL
    WHERE id = ?`,
    [now, now, jobId]
  );

  const updated = getCollectionJobById(db, jobId);
  if (updated) {
    emitDomainEvent("collection_job.cancelled", { job_id: jobId, occurred_at: now });
  }
  return updated;
}

export function getAgentRegistrationBySourceId(
  db: Database,
  sourceId: string
): AgentRegistrationRow | null {
  return getOne<AgentRegistrationRow>(
    db,
    "SELECT * FROM agent_registrations WHERE source_id = ?",
    [sourceId]
  );
}

export function getAgentRegistrationByTokenHash(
  db: Database,
  tokenHash: string
): AgentRegistrationRow | null {
  return getOne<AgentRegistrationRow>(
    db,
    "SELECT * FROM agent_registrations WHERE token_hash = ?",
    [tokenHash]
  );
}

/** e.g. `linux-audit-log` → `collect:linux-audit-log` */
export function collectCapabilityForArtifactType(artifactType: string): string {
  return `collect:${artifactType}`;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw) as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export interface CollectionJobSummary {
  id: string;
  source_id: string;
  artifact_type: string;
  status: string;
  created_at: string;
  request_reason: string | null;
}

/** Why `jobs` is empty (for non-silent client handling). `null` when returning jobs or when there is no queued work. */
export type JobsNextGate =
  | "source_disabled"
  | "heartbeat_required"
  | "capabilities_empty"
  | "capability_mismatch";

export interface ListNextQueuedJobsResult {
  jobs: CollectionJobSummary[];
  /** Present when `jobs` is empty for a gating reason (not when there are simply no queued rows). */
  gate: JobsNextGate | null;
}

function jobPassesCapabilityGate(
  job: CollectionJobRow,
  agentCaps: string[],
  sourceCaps: string[]
): boolean {
  const required = collectCapabilityForArtifactType(job.artifact_type);
  const inter = agentCaps.filter((c) => sourceCaps.includes(c));
  return inter.includes(required);
}

/**
 * Phase 6d jobs/next — FIFO queued jobs for this source (strict gating).
 *
 * - No successful heartbeat yet (`last_heartbeat_at` null) → no jobs (`heartbeat_required`).
 * - Empty capability list after heartbeat → no jobs (`capabilities_empty`).
 * - Otherwise require `collect:<job.artifact_type>` ∈ intersection(agent_caps, source_caps) per job.
 * - If queued jobs exist but none pass → `capability_mismatch`.
 */
export function listNextQueuedJobSummariesForSource(
  db: Database,
  source: SourceRow,
  registration: AgentRegistrationRow,
  limit: number
): ListNextQueuedJobsResult {
  if (!source.enabled) {
    return { jobs: [], gate: "source_disabled" };
  }

  if (!registration.last_heartbeat_at) {
    return { jobs: [], gate: "heartbeat_required" };
  }

  const agentCaps = parseJsonArray(registration.last_capabilities_json ?? "[]");
  if (agentCaps.length === 0) {
    return { jobs: [], gate: "capabilities_empty" };
  }

  const rows = allRows<CollectionJobRow>(
    db,
    `SELECT * FROM collection_jobs
     WHERE source_id = ? AND status = 'queued'
     ORDER BY created_at ASC`,
    [source.id]
  );

  const sourceCaps = parseJsonArray(source.capabilities_json);

  const out: CollectionJobSummary[] = [];
  for (const job of rows) {
    if (!jobPassesCapabilityGate(job, agentCaps, sourceCaps)) continue;
    out.push({
      id: job.id,
      source_id: job.source_id,
      artifact_type: job.artifact_type,
      status: job.status,
      created_at: job.created_at,
      request_reason: job.request_reason,
    });
    if (out.length >= limit) break;
  }

  if (out.length === 0 && rows.length > 0) {
    return { jobs: [], gate: "capability_mismatch" };
  }

  return { jobs: out, gate: null };
}

export interface HeartbeatInput {
  capabilities: string[];
  attributes: Record<string, unknown>;
  agent_version: string;
  active_job_id: string | null;
  /** Required when `active_job_id` is set: must match the job's `lease_owner_instance_id` (caller validates). */
  instance_id: string | null;
}

export type ActiveJobLeaseHeartbeatResult =
  | { requested: false }
  | {
      requested: true;
      job_id: string;
      extended: true;
      lease_expires_at: string;
    }
  | {
      requested: true;
      job_id: string;
      extended: false;
      code: "lease_not_extended";
    };

export interface ApplyAgentHeartbeatResult {
  source: SourceRow;
  registration: AgentRegistrationRow;
  active_job_lease: ActiveJobLeaseHeartbeatResult;
}

/** Extend lease by 120s from max(now, current expiry), capped 30m after claim. */
function extendedLeaseExpiryIso(job: CollectionJobRow, nowMs: number): string {
  const extendMs = 120_000;
  const leaseEnd =
    job.lease_expires_at ? new Date(job.lease_expires_at).getTime() : nowMs;
  const base = Math.max(nowMs, leaseEnd);
  let next = base + extendMs;
  if (job.claimed_at) {
    const cap = new Date(job.claimed_at).getTime() + 30 * 60_000;
    next = Math.min(next, cap);
  }
  return new Date(next).toISOString();
}

export function applyAgentHeartbeat(
  db: Database,
  registration: AgentRegistrationRow,
  source: SourceRow,
  input: HeartbeatInput
): ApplyAgentHeartbeatResult {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const prevHealth = source.health_status;
  let active_job_lease: ActiveJobLeaseHeartbeatResult = { requested: false };

  const capsJson = JSON.stringify(input.capabilities);
  const mergedAttrs = (() => {
    try {
      const prev = JSON.parse(source.attributes_json || "{}") as Record<string, unknown>;
      return JSON.stringify({ ...prev, ...input.attributes });
    } catch {
      return JSON.stringify(input.attributes);
    }
  })();

  db.run(
    `UPDATE sources SET
      last_seen_at = ?,
      health_status = 'online',
      attributes_json = ?,
      updated_at = ?
    WHERE id = ?`,
    [now, mergedAttrs, now, source.id]
  );

  db.run(
    `UPDATE agent_registrations SET
      last_capabilities_json = ?,
      last_heartbeat_at = ?,
      last_agent_version = ?
    WHERE id = ?`,
    [capsJson, now, input.agent_version.trim() || null, registration.id]
  );

  if (prevHealth !== "online") {
    emitDomainEvent("source.health_changed", {
      source_id: source.id,
      previous_health: prevHealth,
      health_status: "online",
      occurred_at: now,
    });
  }

  if (input.active_job_id && input.instance_id) {
    const job = getCollectionJobById(db, input.active_job_id);
    const eligible =
      job &&
      job.source_id === source.id &&
      (job.status === "claimed" || job.status === "running") &&
      job.lease_owner_id === registration.id &&
      job.lease_owner_instance_id === input.instance_id &&
      job.lease_expires_at &&
      job.lease_expires_at > now;

    if (!eligible || !job) {
      active_job_lease = {
        requested: true,
        job_id: input.active_job_id,
        extended: false,
        code: "lease_not_extended",
      };
    } else {
      const prevExp = job.lease_expires_at!;
      const newExp = extendedLeaseExpiryIso(job, nowMs);
      db.run(
        `UPDATE collection_jobs SET
          lease_expires_at = ?,
          last_heartbeat_at = ?,
          updated_at = ?
        WHERE id = ?
          AND source_id = ?
          AND status IN ('claimed', 'running')
          AND lease_owner_id = ?
          AND lease_owner_instance_id = ?
          AND lease_expires_at = ?`,
        [newExp, now, now, job.id, source.id, registration.id, input.instance_id, prevExp]
      );
      const after = getCollectionJobById(db, job.id);
      if (after?.lease_expires_at === newExp) {
        active_job_lease = {
          requested: true,
          job_id: job.id,
          extended: true,
          lease_expires_at: newExp,
        };
      } else {
        active_job_lease = {
          requested: true,
          job_id: job.id,
          extended: false,
          code: "lease_not_extended",
        };
      }
    }
  }

  return {
    source: getSourceById(db, source.id)!,
    registration: getOne<AgentRegistrationRow>(
      db,
      "SELECT * FROM agent_registrations WHERE id = ?",
      [registration.id]
    )!,
    active_job_lease,
  };
}

export function claimCollectionJobForAgent(
  db: Database,
  jobId: string,
  sourceId: string,
  agentRegistrationId: string,
  instanceId: string,
  leaseTtlSeconds: number
):
  | { ok: true; row: CollectionJobRow }
  | { ok: false; code: "not_found" | "not_queued" | "wrong_source" } {
  const job = getCollectionJobById(db, jobId);
  if (!job) {
    return { ok: false, code: "not_found" };
  }
  if (job.source_id !== sourceId) {
    return { ok: false, code: "wrong_source" };
  }
  if (job.status !== "queued") {
    return { ok: false, code: "not_queued" };
  }

  const ttl = Math.min(300, Math.max(60, Math.floor(leaseTtlSeconds)));
  const now = new Date();
  const nowIso = now.toISOString();
  const expires = new Date(now.getTime() + ttl * 1000).toISOString();

  db.run(
    `UPDATE collection_jobs SET
      status = 'claimed',
      lease_owner_id = ?,
      lease_owner_instance_id = ?,
      lease_expires_at = ?,
      claimed_at = ?,
      updated_at = ?,
      last_heartbeat_at = NULL
    WHERE id = ? AND source_id = ? AND status = 'queued'`,
    [agentRegistrationId, instanceId, expires, nowIso, nowIso, jobId, sourceId]
  );

  const claimed = getCollectionJobById(db, jobId);
  if (
    !claimed ||
    claimed.status !== "claimed" ||
    claimed.lease_owner_id !== agentRegistrationId
  ) {
    return { ok: false, code: "not_queued" };
  }

  db.run(`UPDATE agent_registrations SET last_instance_id = ? WHERE id = ?`, [
    instanceId,
    agentRegistrationId,
  ]);

  const row = claimed;
  emitDomainEvent("collection_job.claimed", {
    job_id: jobId,
    lease_owner_id: agentRegistrationId,
    lease_expires_at: expires,
    occurred_at: nowIso,
  });
  return { ok: true, row };
}

export function startCollectionJobForAgent(
  db: Database,
  jobId: string,
  sourceId: string,
  agentRegistrationId: string,
  instanceId: string
):
  | { ok: true; row: CollectionJobRow }
  | { ok: false; code: "wrong_job" | "not_claimed" | "lease_expired" | "wrong_lease" } {
  const job = getCollectionJobById(db, jobId);
  if (!job || job.source_id !== sourceId) return { ok: false, code: "wrong_job" };
  if (job.status !== "claimed") return { ok: false, code: "not_claimed" };
  if (job.lease_owner_id !== agentRegistrationId || job.lease_owner_instance_id !== instanceId) {
    return { ok: false, code: "wrong_lease" };
  }
  const nowIso = new Date().toISOString();
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return { ok: false, code: "lease_expired" };
  }

  const expires = new Date(Date.now() + 300_000).toISOString();
  db.run(
    `UPDATE collection_jobs SET
      status = 'running',
      started_at = ?,
      lease_expires_at = ?,
      updated_at = ?
    WHERE id = ? AND status = 'claimed'
      AND lease_owner_id = ? AND lease_owner_instance_id = ?
      AND lease_expires_at > ?`,
    [nowIso, expires, nowIso, jobId, agentRegistrationId, instanceId, nowIso]
  );

  const row = getCollectionJobById(db, jobId);
  if (!row || row.status !== "running") {
    return { ok: false, code: "not_claimed" };
  }
  emitDomainEvent("collection_job.running", { job_id: jobId, occurred_at: nowIso });
  return { ok: true, row };
}

export function failCollectionJobForAgent(
  db: Database,
  jobId: string,
  sourceId: string,
  agentRegistrationId: string,
  instanceId: string,
  errorCode: string,
  errorMessage: string
):
  | { ok: true; row: CollectionJobRow }
  | { ok: false; code: "wrong_job" | "bad_state" | "lease_expired" | "wrong_lease" } {
  const job = getCollectionJobById(db, jobId);
  if (!job || job.source_id !== sourceId) return { ok: false, code: "wrong_job" };
  if (job.status !== "claimed" && job.status !== "running") {
    return { ok: false, code: "bad_state" };
  }
  if (job.lease_owner_id !== agentRegistrationId || job.lease_owner_instance_id !== instanceId) {
    return { ok: false, code: "wrong_lease" };
  }
  const nowIso = new Date().toISOString();
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return { ok: false, code: "lease_expired" };
  }

  const code = errorCode.trim().slice(0, 128) || "agent_failed";
  const msg = errorMessage.trim().slice(0, 2048) || "failed";

  db.run(
    `UPDATE collection_jobs SET
      status = 'failed',
      error_code = ?,
      error_message = ?,
      finished_at = ?,
      updated_at = ?,
      lease_owner_id = NULL,
      lease_owner_instance_id = NULL,
      lease_expires_at = NULL,
      last_heartbeat_at = NULL
    WHERE id = ? AND source_id = ?
      AND status IN ('claimed', 'running')
      AND lease_owner_id = ? AND lease_owner_instance_id = ?
      AND lease_expires_at > ?`,
    [code, msg, nowIso, nowIso, jobId, sourceId, agentRegistrationId, instanceId, nowIso]
  );

  const row = getCollectionJobById(db, jobId);
  if (!row || row.status !== "failed") {
    return { ok: false, code: "bad_state" };
  }
  emitDomainEvent("collection_job.failed", {
    job_id: jobId,
    error_code: code,
    error_message: msg,
    occurred_at: nowIso,
  });
  return { ok: true, row };
}

export function markCollectionJobSubmittedForAgent(
  db: Database,
  jobId: string,
  sourceId: string,
  agentRegistrationId: string,
  instanceId: string,
  artifactId: string,
  runId: string,
  /** Persisted on the job so operators see analysis outcome while `status` stays `submitted` (artifact accepted). */
  resultRunStatus: string
): CollectionJobRow | null {
  const nowIso = new Date().toISOString();
  db.run(
    `UPDATE collection_jobs SET
      status = 'submitted',
      result_artifact_id = ?,
      result_run_id = ?,
      result_analysis_status = ?,
      submitted_at = ?,
      finished_at = ?,
      updated_at = ?,
      lease_owner_id = NULL,
      lease_owner_instance_id = NULL,
      lease_expires_at = NULL,
      last_heartbeat_at = NULL
    WHERE id = ? AND source_id = ?
      AND status = 'running'
      AND lease_owner_id = ? AND lease_owner_instance_id = ?
      AND lease_expires_at > ?`,
    [
      artifactId,
      runId,
      resultRunStatus,
      nowIso,
      nowIso,
      nowIso,
      jobId,
      sourceId,
      agentRegistrationId,
      instanceId,
      nowIso,
    ]
  );
  const row = getCollectionJobById(db, jobId);
  if (row?.status === "submitted") {
    emitDomainEvent("collection_job.submitted", {
      job_id: jobId,
      artifact_id: artifactId,
      run_id: runId,
      occurred_at: nowIso,
    });
  }
  return row?.status === "submitted" ? row : null;
}

export interface AgentRegistrationCreated {
  row: AgentRegistrationRow;
  plainToken: string;
  token_prefix: string;
}

export function createAgentRegistration(
  db: Database,
  sourceId: string,
  displayName?: string | null
): AgentRegistrationCreated {
  const source = getSourceById(db, sourceId);
  if (!source) {
    const err = new Error("source_not_found");
    (err as Error & { code: string }).code = "source_not_found";
    throw err;
  }
  if (getAgentRegistrationBySourceId(db, sourceId)) {
    const err = new Error("already_registered");
    (err as Error & { code: string }).code = "source_already_registered";
    throw err;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const plainToken = generateAgentToken();
  const tokenHash = hashAgentToken(plainToken);
  const token_prefix = plainToken.slice(0, 8);

  db.run(
    `INSERT INTO agent_registrations (id, source_id, token_hash, display_name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, sourceId, tokenHash, displayName?.trim() ?? null, now]
  );

  const row = getOne<AgentRegistrationRow>(
    db,
    "SELECT * FROM agent_registrations WHERE id = ?",
    [id]
  )!;

  return { row, plainToken, token_prefix };
}

/** Reap expired leases: `claimed` → `queued`, `running` → `expired`. Returns number of rows updated. */
export function reapExpiredCollectionJobLeases(db: Database): number {
  const now = new Date().toISOString();
  let n = 0;

  const claimed = allRows<CollectionJobRow>(
    db,
    `SELECT * FROM collection_jobs
     WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
    [now]
  );

  for (const job of claimed) {
    db.run(
      `UPDATE collection_jobs SET
        status = 'queued', updated_at = ?,
        lease_owner_id = NULL, lease_owner_instance_id = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL
      WHERE id = ? AND status = 'claimed'`,
      [now, job.id]
    );
    n++;
    emitDomainEvent("collection_job.lease_lost", {
      job_id: job.id,
      source_id: job.source_id,
      requeued: true,
      occurred_at: now,
    });
  }

  const running = allRows<CollectionJobRow>(
    db,
    `SELECT * FROM collection_jobs
     WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
    [now]
  );

  for (const job of running) {
    db.run(
      `UPDATE collection_jobs SET
        status = 'expired', error_code = 'lease_lost', error_message = 'Lease expired while running; create a new job to retry.',
        finished_at = ?, updated_at = ?,
        lease_owner_id = NULL, lease_owner_instance_id = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL
      WHERE id = ? AND status = 'running'`,
      [now, now, job.id]
    );
    n++;
    emitDomainEvent("collection_job.expired", {
      job_id: job.id,
      source_id: job.source_id,
      error_code: "lease_lost",
      occurred_at: now,
    });
  }

  return n;
}

export function sourceToJson(row: SourceRow) {
  let capabilities: string[] = [];
  let attributes: Record<string, unknown> = {};
  let labels: Record<string, string> = {};
  try {
    capabilities = JSON.parse(row.capabilities_json) as string[];
  } catch {
    capabilities = [];
  }
  try {
    attributes = JSON.parse(row.attributes_json) as Record<string, unknown>;
  } catch {
    attributes = {};
  }
  try {
    labels = JSON.parse(row.labels_json) as Record<string, string>;
  } catch {
    labels = {};
  }

  return {
    id: row.id,
    display_name: row.display_name,
    target_identifier: row.target_identifier,
    source_type: row.source_type,
    expected_artifact_type: row.expected_artifact_type,
    default_collector_type: row.default_collector_type,
    default_collector_version: row.default_collector_version,
    capabilities,
    attributes,
    labels,
    enabled: row.enabled === 1,
    last_seen_at: row.last_seen_at,
    health_status: row.health_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function collectionJobToJson(row: CollectionJobRow) {
  return {
    id: row.id,
    source_id: row.source_id,
    artifact_type: row.artifact_type,
    status: row.status,
    requested_by: row.requested_by,
    request_reason: row.request_reason,
    priority: row.priority,
    idempotency_key: row.idempotency_key,
    lease_owner_id: row.lease_owner_id,
    lease_owner_instance_id: row.lease_owner_instance_id,
    lease_expires_at: row.lease_expires_at,
    last_heartbeat_at: row.last_heartbeat_at,
    result_artifact_id: row.result_artifact_id,
    result_run_id: row.result_run_id,
    error_code: row.error_code,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    queued_at: row.queued_at,
    claimed_at: row.claimed_at,
    started_at: row.started_at,
    submitted_at: row.submitted_at,
    finished_at: row.finished_at,
    result_analysis_status: row.result_analysis_status ?? null,
  };
}
