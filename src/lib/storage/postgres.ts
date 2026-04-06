import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { Finding } from "@/lib/analyzer/schema";
import { isSupportedArtifactType } from "@/lib/adapter/registry";
import {
  parseCollectionScopeJson,
  validateCollectionScopeForArtifactType,
  type CollectionScope,
} from "@/lib/collection-scope";
import { buildRunDetail, toRunDetailJson } from "@/lib/api/run-detail-json";
import {
  contentHash,
  parseEnvironmentHostname,
  submissionMetaFromRun,
  type RunRow,
  type RunWithArtifactRow,
} from "@/lib/db/repository";
import { compareFindingsDrift, type FindingsDriftResult } from "@/lib/compare/findings-diff";
import { buildEvidenceDelta } from "@/lib/compare/evidence-delta";
import type {
  AgentsStore,
  CollectionJobView,
  JobsStore,
  PersistAnalyzedRunInput,
  PersistAnalyzedRunResult,
  ReanalyzeSourceResult,
  RunsStore,
  SourcesStore,
  SourceView,
  Storage,
  StorageTx,
} from "./contract";
import {
  mapRunSummaryRow,
  parseFindingsFromReportJson,
  runAttentionScore,
  toRunSubmissionMeta,
  validateAgentSubmissionState,
} from "./shared/run-shared";
import {
  buildHeartbeatLeaseExpiryIso,
  buildListNextQueuedJobsResult,
  mergeHeartbeatAttributesJson,
  normalizeHeartbeatAgentVersion,
  validateHeartbeatActiveJob,
} from "./shared/agent-lifecycle-shared";
import { projectCollectionJobLeaseReadModel } from "./shared/job-read-model";
import {
  buildClaimLease,
  buildStartLeaseExpiryIso,
  normalizeAgentFailureInput,
  validateClaimCommand,
  validateFailCommand,
  validateStartCommand,
} from "./shared/job-command-shared";
import {
  generateAgentToken,
  hashAgentToken,
  type AgentRegistrationCreated,
  type AgentRegistrationRow,
  type ApplyAgentHeartbeatResult,
  type ListNextQueuedJobsResult,
  type PatchSourceInput,
  type SourceRow,
} from "@/lib/db/source-job-repository";
import type { CompareDriftPayload, CompareRunSnapshot } from "@/lib/compare/build-compare";
import {
  compareTargetsMismatch,
  normalizeTargetIdentifier,
  preferredTargetDisplayLabel,
  preferredTargetMatchKey,
} from "@/lib/target-identity";
import { emitDomainEvent } from "@/lib/domain-events";
import { defaultCapabilitiesForArtifactType } from "@/lib/source-catalog";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type PgArtifactRow = {
  id: string;
  created_at: string;
  artifact_type: string;
  source_type: string;
  filename: string;
  content_hash: string;
  content: string;
};

type PgRunWithArtifactRow = RunWithArtifactRow;

type PgSourceRow = {
  id: string;
  display_name: string;
  target_identifier: string;
  target_identifier_norm: string | null;
  source_type: string;
  expected_artifact_type: string;
  default_collector_type: string;
  default_collector_version: string | null;
  capabilities_json: string;
  attributes_json: string;
  labels_json: string;
  default_collection_scope_json: string | null;
  enabled: boolean;
  last_seen_at: string | null;
  health_status: string;
  created_at: string;
  updated_at: string;
};

type PgCollectionJobRow = {
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
  result_analysis_status: string | null;
  collection_scope_json: string | null;
};

type PgAgentRegistrationRow = {
  id: string;
  source_id: string;
  token_hash: string;
  display_name: string | null;
  created_at: string;
  last_capabilities_json: string;
  last_heartbeat_at: string | null;
  last_agent_version: string | null;
  last_instance_id: string | null;
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function many<T extends QueryResultRow>(
  q: Queryable,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await q.query<T>(sql, params);
  return res.rows;
}

async function one<T extends QueryResultRow>(
  q: Queryable,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const res = await q.query<T>(sql, params);
  return res.rows[0] ?? null;
}

function sourceToView(row: PgSourceRow): SourceView {
  return {
    id: row.id,
    display_name: row.display_name,
    target_identifier: row.target_identifier,
    source_type: row.source_type,
    expected_artifact_type: row.expected_artifact_type,
    default_collector_type: row.default_collector_type,
    default_collector_version: row.default_collector_version,
    capabilities: parseJson<string[]>(row.capabilities_json, []),
    attributes: parseJson<Record<string, unknown>>(row.attributes_json, {}),
    labels: parseJson<Record<string, string>>(row.labels_json, {}),
    default_collection_scope: parseCollectionScopeJson(row.default_collection_scope_json),
    enabled: Boolean(row.enabled),
    last_seen_at: row.last_seen_at,
    health_status: row.health_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sourceToHeartbeatRow(row: PgSourceRow): SourceRow {
  return {
    id: row.id,
    display_name: row.display_name,
    target_identifier: row.target_identifier,
    target_identifier_norm: row.target_identifier_norm,
    source_type: row.source_type,
    expected_artifact_type: row.expected_artifact_type,
    default_collector_type: row.default_collector_type,
    default_collector_version: row.default_collector_version,
    capabilities_json: row.capabilities_json,
    attributes_json: row.attributes_json,
    labels_json: row.labels_json,
    default_collection_scope_json: row.default_collection_scope_json,
    enabled: row.enabled ? 1 : 0,
    last_seen_at: row.last_seen_at,
    health_status: row.health_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function registrationToHeartbeatRow(row: PgAgentRegistrationRow): AgentRegistrationRow {
  return {
    id: row.id,
    source_id: row.source_id,
    token_hash: row.token_hash,
    display_name: row.display_name,
    created_at: row.created_at,
    last_capabilities_json: row.last_capabilities_json,
    last_heartbeat_at: row.last_heartbeat_at,
    last_agent_version: row.last_agent_version,
    last_instance_id: row.last_instance_id,
  };
}

function jobToView(row: PgCollectionJobRow): CollectionJobView {
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
    result_analysis_status: row.result_analysis_status,
    collection_scope: parseCollectionScopeJson(row.collection_scope_json),
  };
}

function emptyDrift(): FindingsDriftResult {
  return {
    summary: { new: 0, resolved: 0, severity_up: 0, severity_down: 0, unchanged: 0 },
    rows: [],
  };
}

function parseFindings(reportJson: string | null): Finding[] {
  if (!reportJson) return [];
  try {
    const report = JSON.parse(reportJson) as { findings?: Finding[] };
    return Array.isArray(report.findings) ? report.findings : [];
  } catch {
    return [];
  }
}

function snapshotFromRun(row: RunWithArtifactRow): CompareRunSnapshot {
  const host = parseEnvironmentHostname(row.environment_json ?? null);
  return {
    id: row.id,
    run_id: row.id,
    filename: row.filename,
    created_at: row.created_at,
    target_identifier: row.target_identifier ?? null,
    environment_hostname: host,
    target_display_label: preferredTargetDisplayLabel({
      target_identifier: row.target_identifier ?? null,
      environment_hostname: host,
      artifact_type: row.artifact_type,
      artifact_content: row.artifact_content,
    }),
  };
}

async function getRunById(q: Queryable, id: string): Promise<RunRow | null> {
  return one<RunRow>(q, "SELECT * FROM runs WHERE id = $1", [id]);
}

async function getArtifactById(q: Queryable, id: string): Promise<PgArtifactRow | null> {
  return one<PgArtifactRow>(q, "SELECT * FROM artifacts WHERE id = $1", [id]);
}

async function getRunWithArtifactById(q: Queryable, id: string): Promise<PgRunWithArtifactRow | null> {
  return one<PgRunWithArtifactRow>(
    q,
    `SELECT r.*, a.artifact_type, a.content AS artifact_content
     FROM runs r
     JOIN artifacts a ON a.id = r.artifact_id
     WHERE r.id = $1`,
    [id]
  );
}

async function findPreviousRunForSameTarget(q: Queryable, currentRunId: string): Promise<RunWithArtifactRow | null> {
  const current = await getRunWithArtifactById(q, currentRunId);
  if (!current) return null;

  const currentMatchKey = preferredTargetMatchKey({
    target_identifier: current.target_identifier,
    environment_hostname: parseEnvironmentHostname(current.environment_json),
    artifact_type: current.artifact_type,
    artifact_content: current.artifact_content,
  });
  const candidates = await many<PgRunWithArtifactRow>(
    q,
    `SELECT r.*, a.artifact_type, a.content AS artifact_content
     FROM runs r
     JOIN artifacts a ON a.id = r.artifact_id
     WHERE r.id != $1 AND r.created_at <= $2 AND a.artifact_type = $3
     ORDER BY r.created_at DESC, r.id DESC`,
    [currentRunId, current.created_at, current.artifact_type]
  );

  if (currentMatchKey) {
    const hit = candidates.find(
      (candidate) =>
        preferredTargetMatchKey({
          target_identifier: candidate.target_identifier,
          environment_hostname: parseEnvironmentHostname(candidate.environment_json),
          artifact_type: candidate.artifact_type,
          artifact_content: candidate.artifact_content,
        }) === currentMatchKey
    );
    if (hit) return hit;
    return null;
  }
  return candidates.find((c) => c.artifact_id === current.artifact_id) ?? null;
}

async function insertArtifactPg(
  q: Queryable,
  opts: { artifact_type: string; source_type: string; filename: string; content: string }
) {
  const hash = contentHash(opts.content, opts.artifact_type);
  const legacyHash = createHash("sha256").update(opts.content, "utf8").digest("hex");
  const existing = await one<PgArtifactRow>(
    q,
    `SELECT * FROM artifacts
     WHERE content_hash = $1
        OR (artifact_type = $2 AND content_hash = $3)
     ORDER BY CASE WHEN content_hash = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [hash, opts.artifact_type, legacyHash]
  );
  if (existing) return existing;
  const id = randomUUID();
  const now = new Date().toISOString();
  const inserted = await q.query<PgArtifactRow>(
    `INSERT INTO artifacts (id, created_at, artifact_type, source_type, filename, content_hash, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (content_hash) DO NOTHING
     RETURNING *`,
    [id, now, opts.artifact_type, opts.source_type, opts.filename, hash, opts.content]
  );
  if (inserted.rows[0]) return inserted.rows[0];
  return (
    (await one<PgArtifactRow>(q, "SELECT * FROM artifacts WHERE content_hash = $1", [hash])) ??
    (await one<PgArtifactRow>(
      q,
      `SELECT * FROM artifacts
       WHERE artifact_type = $1 AND content_hash = $2
       LIMIT 1`,
      [opts.artifact_type, legacyHash]
    ))!
  );
}

async function insertRunPg(
  q: Queryable,
  artifactId: string,
  result: PersistAnalyzedRunInput["analysis"],
  submission: PersistAnalyzedRunInput["ingestion"] & { filename: string; source_type: string },
  parentRunId?: string
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status = result.analysis_error && !result.report ? "error" : "complete";
  await q.query(
    `INSERT INTO runs (
      id, artifact_id, parent_run_id, created_at, status,
      report_json, environment_json, noise_json, pre_findings_json,
      is_incomplete, incomplete_reason, analysis_error,
      model_used, tokens_used, duration_ms, filename, source_type,
      target_identifier, source_label, collector_type, collector_version, collected_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22
    )`,
    [
      id,
      artifactId,
      parentRunId ?? null,
      now,
      status,
      result.report ? JSON.stringify(result.report) : null,
      JSON.stringify(result.environment),
      JSON.stringify(result.noise),
      JSON.stringify(result.pre_findings),
      Boolean(result.is_incomplete),
      result.incomplete_reason ?? null,
      result.analysis_error ?? null,
      result.meta.model_used,
      result.meta.tokens_used,
      result.meta.duration_ms,
      submission.filename,
      submission.source_type,
      submission.target_identifier,
      submission.source_label,
      submission.collector_type,
      submission.collector_version,
      submission.collected_at,
    ]
  );
  return (await getRunById(q, id))!;
}

class PostgresRunsStore implements RunsStore {
  constructor(private readonly q: Queryable) {}

  async listSummaries() {
    const rows = await many<{
      id: string;
      artifact_id: string;
      filename: string;
      artifact_type: string;
      source_type: string;
      created_at: string;
      status: string;
      report_json: string | null;
      environment_json: string | null;
      target_identifier: string | null;
      collector_type: string | null;
    }>(
      this.q,
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON a.id = r.artifact_id
       ORDER BY r.created_at DESC`
    );
    return rows.map(mapRunSummaryRow);
  }

  async countRuns() {
    const row = await one<{ total: string | number }>(this.q, "SELECT COUNT(*) AS total FROM runs");
    return Number(row?.total ?? 0);
  }

  async listDashboardRecentRuns(limit: number) {
    const cappedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const rows = await many<{
      id: string;
      artifact_id: string;
      filename: string;
      artifact_type: string;
      source_type: string;
      created_at: string;
      status: string;
      report_json: string | null;
      environment_json: string | null;
      target_identifier: string | null;
      collector_type: string | null;
    }>(
      this.q,
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON a.id = r.artifact_id
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [cappedLimit]
    );
    return rows.map(mapRunSummaryRow);
  }

  async listDashboardWindowRuns(sinceIso: string) {
    const rows = await many<{
      id: string;
      artifact_id: string;
      filename: string;
      artifact_type: string;
      source_type: string;
      created_at: string;
      status: string;
      report_json: string | null;
      environment_json: string | null;
      target_identifier: string | null;
      collector_type: string | null;
    }>(
      this.q,
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON a.id = r.artifact_id
       WHERE r.created_at >= $1
       ORDER BY r.created_at DESC`,
      [sinceIso]
    );
    return rows.map(mapRunSummaryRow);
  }

  async listDashboardSignalRuns(limit: number) {
    const cappedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const scanLimit = Math.min(1000, Math.max(200, cappedLimit * 200));
    const rows = await many<{
      id: string;
      artifact_id: string;
      filename: string;
      artifact_type: string;
      source_type: string;
      created_at: string;
      status: string;
      report_json: string | null;
      environment_json: string | null;
      target_identifier: string | null;
      collector_type: string | null;
    }>(
      this.q,
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON a.id = r.artifact_id
       WHERE r.report_json IS NOT NULL
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [scanLimit]
    );

    const out: Awaited<ReturnType<RunsStore["listDashboardSignalRuns"]>> = [];
    for (const row of rows) {
      if (out.length >= cappedLimit) break;
      const run = mapRunSummaryRow(row);
      if (runAttentionScore(run) <= 0) continue;
      const findings = parseFindingsFromReportJson(row.report_json);
      if (findings.length === 0) continue;
      out.push({ run, findings });
    }
    return out;
  }

  async countSuppressedNoise() {
    const rows = await many<{ noise_json: string | null }>(
      this.q,
      "SELECT noise_json FROM runs WHERE noise_json IS NOT NULL"
    );
    let total = 0;
    for (const row of rows) {
      const items = parseJson<unknown[]>(row.noise_json, []);
      if (Array.isArray(items)) total += items.length;
    }
    return total;
  }

  async getApiDetail(id: string) {
    const row = await getRunWithArtifactById(this.q, id);
    return row ? toRunDetailJson(row) : null;
  }

  async getPageDetail(id: string) {
    const row = await getRunWithArtifactById(this.q, id);
    if (!row) return null;
    const parent = row.parent_run_id ? await getRunById(this.q, row.parent_run_id) : null;
    return buildRunDetail(
      row,
      parent ? { id: parent.id, filename: parent.filename } : null,
      row.artifact_content
    );
  }

  async getReport(id: string) {
    const run = await getRunById(this.q, id);
    if (!run?.report_json) return null;
    return JSON.parse(run.report_json);
  }

  async getComparePayload(id: string, against?: string | null) {
    if (against && against === id) {
      return { ok: false as const, error: "against_equals_current" as const };
    }
    const currentRow = await getRunWithArtifactById(this.q, id);
    if (!currentRow) {
      return { ok: false as const, error: "current_not_found" as const };
    }
    const baselineRow = against ? await getRunWithArtifactById(this.q, against) : await findPreviousRunForSameTarget(this.q, id);
    if (against && !baselineRow) {
      return { ok: false as const, error: "baseline_not_found" as const };
    }
    const baselineMissing = baselineRow === null;
    const drift = baselineRow ?
      compareFindingsDrift(parseFindings(baselineRow.report_json), parseFindings(currentRow.report_json))
      : emptyDrift();
    const targetMismatch = Boolean(
      baselineRow &&
        compareTargetsMismatch(
          {
            target_identifier: currentRow.target_identifier ?? null,
            environment_hostname: parseEnvironmentHostname(currentRow.environment_json ?? null),
            artifact_type: currentRow.artifact_type,
            artifact_content: currentRow.artifact_content,
          },
          {
            target_identifier: baselineRow.target_identifier ?? null,
            environment_hostname: parseEnvironmentHostname(baselineRow.environment_json ?? null),
            artifact_type: baselineRow.artifact_type,
            artifact_content: baselineRow.artifact_content,
          }
        )
    );
    const payload: CompareDriftPayload = {
      current: snapshotFromRun(currentRow),
      baseline: baselineRow ? snapshotFromRun(baselineRow) : null,
      baseline_missing: baselineMissing,
      target_mismatch: targetMismatch,
      baseline_selection: baselineMissing ? "none" : against ? "explicit" : "implicit_same_target",
      against_requested: against ?? null,
      drift,
      evidence_delta: buildEvidenceDelta(baselineRow, currentRow),
    };
    return { ok: true as const, payload };
  }

  async getReanalyzeSource(parentRunId: string): Promise<ReanalyzeSourceResult> {
    const run = await getRunById(this.q, parentRunId);
    if (!run) return { ok: false, error: "run_not_found" };
    const artifact = await getArtifactById(this.q, run.artifact_id);
    if (!artifact) return { ok: false, error: "artifact_not_found" };
    return {
      ok: true,
      artifact_id: artifact.id,
      artifact_type: artifact.artifact_type,
      content: artifact.content,
      submission: submissionMetaFromRun(run),
    };
  }

  async persistAnalyzedRun(input: PersistAnalyzedRunInput): Promise<PersistAnalyzedRunResult> {
    const artifact = await insertArtifactPg(this.q, {
      artifact_type: input.artifactType,
      source_type: input.sourceType,
      filename: input.filename,
      content: input.content,
    });
    const run = await insertRunPg(
      this.q,
      artifact.id,
      input.analysis,
      toRunSubmissionMeta({
        filename: input.filename,
        sourceType: input.sourceType,
        ingestion: input.ingestion,
      }),
      input.parentRunId
    );
    return {
      run_id: run.id,
      artifact_id: artifact.id,
      status: run.status,
      report: input.analysis.report,
    };
  }
}

class PostgresSourcesStore implements SourcesStore {
  constructor(private readonly q: Queryable) {}

  async list(opts?: { enabled?: boolean }) {
    const where =
      opts?.enabled === true ? "WHERE enabled = TRUE"
      : opts?.enabled === false ? "WHERE enabled = FALSE"
      : "";
    const rows = await many<PgSourceRow>(this.q, `SELECT * FROM sources ${where} ORDER BY created_at DESC`);
    return rows.map(sourceToView);
  }

  async listDashboardCollectionSourceStates(opts?: { enabled?: boolean }) {
    const where =
      opts?.enabled === true ? "WHERE s.enabled = TRUE"
      : opts?.enabled === false ? "WHERE s.enabled = FALSE"
      : "";

    const rows = await many<
      PgSourceRow & {
        has_registration: boolean;
      }
    >(
      this.q,
      `SELECT s.*,
              EXISTS(
                SELECT 1
                FROM agent_registrations ar
                WHERE ar.source_id = s.id
              ) AS has_registration
       FROM sources s
       ${where}
       ORDER BY s.created_at DESC`
    );

    return rows.map((row) => ({
      source: sourceToView(row),
      hasRegistration: Boolean(row.has_registration),
    }));
  }

  async getById(id: string) {
    const row = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [id]);
    return row ? sourceToView(row) : null;
  }

  async create(input: Parameters<SourcesStore["create"]>[0]) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const expected = input.expected_artifact_type ?? "linux-audit-log";
    if (!isSupportedArtifactType(expected)) {
      const err = new Error("unsupported_artifact_type") as Error & { code: string };
      err.code = "unsupported_artifact_type";
      throw err;
    }
    const defaultCollectionScope = input.default_collection_scope ?? null;
    const defaultScopeValidation = validateCollectionScopeForArtifactType(
      defaultCollectionScope,
      expected
    );
    if (!defaultScopeValidation.ok) {
      const err = new Error("invalid_default_collection_scope") as Error & { code: string };
      err.code = "invalid_default_collection_scope";
      throw err;
    }
    const targetNorm = normalizeTargetIdentifier(input.target_identifier);
    if (!targetNorm) throw new Error("target_identifier is required");
    await this.q.query(
      `INSERT INTO sources (
        id, display_name, target_identifier, target_identifier_norm, source_type, expected_artifact_type,
        default_collector_type, default_collector_version, capabilities_json, attributes_json, labels_json,
        default_collection_scope_json, enabled, last_seen_at, health_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, NULL, 'unknown', $14, $15
      )`,
      [
        id,
        input.display_name.trim(),
        input.target_identifier.trim(),
        targetNorm,
        input.source_type,
        expected,
        input.default_collector_type ?? "signalforge-collectors",
        input.default_collector_version ?? null,
        JSON.stringify(input.capabilities?.length ? input.capabilities : defaultCapabilitiesForArtifactType(expected)),
        JSON.stringify(input.attributes ?? {}),
        JSON.stringify(input.labels ?? {}),
        defaultCollectionScope ? JSON.stringify(defaultCollectionScope) : null,
        input.enabled !== false,
        now,
        now,
      ]
    );
    emitDomainEvent("source.registered", {
      source_id: id,
      target_identifier: input.target_identifier.trim(),
      source_type: input.source_type,
      occurred_at: now,
    });
    return (await this.getById(id))!;
  }

  async update(id: string, patch: PatchSourceInput) {
    const row = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [id]);
    if (!row) return null;
    const now = new Date().toISOString();
    const next = {
      display_name: patch.display_name !== undefined ? patch.display_name.trim() : row.display_name,
      default_collector_type:
        patch.default_collector_type !== undefined ? patch.default_collector_type.trim() : row.default_collector_type,
      default_collector_version:
        patch.default_collector_version !== undefined ? patch.default_collector_version : row.default_collector_version,
      capabilities_json:
        patch.capabilities !== undefined ? JSON.stringify(patch.capabilities) : row.capabilities_json,
      labels_json:
        patch.labels !== undefined ? JSON.stringify(patch.labels) : row.labels_json,
      attributes_json:
        patch.attributes !== undefined ?
          JSON.stringify({ ...parseJson<Record<string, unknown>>(row.attributes_json, {}), ...patch.attributes })
        : row.attributes_json,
      default_collection_scope_json:
        patch.default_collection_scope !== undefined ?
          patch.default_collection_scope ? JSON.stringify(patch.default_collection_scope) : null
        : row.default_collection_scope_json,
      enabled:
        patch.enabled !== undefined ? patch.enabled : Boolean(row.enabled),
    };
    if (patch.default_collection_scope !== undefined) {
      const validation = validateCollectionScopeForArtifactType(
        patch.default_collection_scope,
        row.expected_artifact_type
      );
      if (!validation.ok) {
        const err = new Error("invalid_default_collection_scope") as Error & { code: string };
        err.code = "invalid_default_collection_scope";
        throw err;
      }
    }
    await this.q.query(
      `UPDATE sources SET
        display_name = $1,
        default_collector_type = $2,
        default_collector_version = $3,
        capabilities_json = $4,
        labels_json = $5,
        attributes_json = $6,
        default_collection_scope_json = $7,
        enabled = $8,
        updated_at = $9
       WHERE id = $10`,
      [
        next.display_name,
        next.default_collector_type,
        next.default_collector_version,
        next.capabilities_json,
        next.labels_json,
        next.attributes_json,
        next.default_collection_scope_json,
        next.enabled,
        now,
        id,
      ]
    );
    return (await this.getById(id))!;
  }

  async delete(id: string) {
    const row = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [id]);
    if (!row) {
      return { ok: false as const, code: "not_found" as const };
    }

    await new PostgresJobsStore(this.q).reapExpiredLeases();
    const blockingJob = await one<{ id: string }>(
      this.q,
      `SELECT id FROM collection_jobs
       WHERE source_id = $1 AND status IN ('claimed', 'running')
       LIMIT 1`,
      [id]
    );
    if (blockingJob) {
      return { ok: false as const, code: "active_jobs" as const };
    }

    await this.q.query("DELETE FROM agent_registrations WHERE source_id = $1", [id]);
    await this.q.query("DELETE FROM collection_jobs WHERE source_id = $1", [id]);
    await this.q.query("DELETE FROM sources WHERE id = $1", [id]);

    emitDomainEvent("source.deleted", {
      source_id: row.id,
      target_identifier: row.target_identifier,
      occurred_at: new Date().toISOString(),
    });

    return { ok: true as const };
  }
}

class PostgresJobsStore implements JobsStore {
  constructor(private readonly q: Queryable) {}

  async listForSource(sourceId: string, opts?: { status?: string }) {
    const rows = await many<PgCollectionJobRow>(
      this.q,
      "SELECT * FROM collection_jobs WHERE source_id = $1 ORDER BY created_at DESC",
      [sourceId]
    );
    const projected = rows.map(jobToView).map((job) => projectCollectionJobLeaseReadModel(job));
    return opts?.status ? projected.filter((job) => job.status === opts.status) : projected;
  }

  async getById(id: string) {
    const row = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [id]);
    return row ? projectCollectionJobLeaseReadModel(jobToView(row)) : null;
  }

  async queueForSource(
    sourceId: string,
    input: {
      request_reason?: string | null;
      priority?: number;
      idempotency_key?: string | null;
      collection_scope?: CollectionScope | null;
    }
  ) {
    const source = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [sourceId]);
    if (!source) {
      const err = new Error("source_not_found");
      (err as Error & { code: string }).code = "source_not_found";
      throw err;
    }
    if (!source.enabled) {
      const err = new Error("source_disabled");
      (err as Error & { code: string }).code = "source_disabled";
      throw err;
    }
    if (!isSupportedArtifactType(source.expected_artifact_type)) {
      const err = new Error("unsupported_artifact_type") as Error & { code: string };
      err.code = "unsupported_artifact_type";
      throw err;
    }
    if (input.idempotency_key?.trim()) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const existing = await one<PgCollectionJobRow>(
        this.q,
        `SELECT * FROM collection_jobs
         WHERE source_id = $1 AND idempotency_key = $2 AND created_at >= $3
         ORDER BY created_at DESC LIMIT 1`,
        [sourceId, input.idempotency_key.trim(), cutoff]
      );
      if (existing) return { row: jobToView(existing), inserted: false };
    }
    const collectionScope =
      input.collection_scope ?? parseCollectionScopeJson(source.default_collection_scope_json);
    const scopeValidation = validateCollectionScopeForArtifactType(
      collectionScope,
      source.expected_artifact_type
    );
    if (!scopeValidation.ok) {
      const err = new Error("invalid_collection_scope") as Error & { code: string };
      err.code = "invalid_collection_scope";
      throw err;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.q.query(
      `INSERT INTO collection_jobs (
        id, source_id, artifact_type, status, requested_by, request_reason, priority,
        idempotency_key, created_at, updated_at, queued_at, collection_scope_json
      ) VALUES ($1, $2, $3, 'queued', 'operator', $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        sourceId,
        source.expected_artifact_type,
        input.request_reason?.trim() ?? null,
        input.priority ?? 0,
        input.idempotency_key?.trim() ?? null,
        now,
        now,
        now,
        collectionScope ? JSON.stringify(collectionScope) : null,
      ]
    );
    const row = (await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [id]))!;
    emitDomainEvent("collection_job.requested", {
      job_id: row.id,
      source_id: row.source_id,
      artifact_type: row.artifact_type,
      occurred_at: now,
    });
    return { row: jobToView(row), inserted: true };
  }

  async cancel(id: string) {
    await this.reapExpiredLeases();
    const job = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [id]);
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
    await this.q.query(
      `UPDATE collection_jobs SET
        status = 'cancelled',
        error_code = 'cancelled',
        error_message = 'Cancelled by operator',
        finished_at = $1,
        updated_at = $2,
        lease_owner_id = NULL,
        lease_owner_instance_id = NULL,
        lease_expires_at = NULL,
        last_heartbeat_at = NULL
       WHERE id = $3`,
      [now, now, id]
    );
    emitDomainEvent("collection_job.cancelled", { job_id: id, occurred_at: now });
    return (await this.getById(id))!;
  }

  async reapExpiredLeases() {
    const now = new Date().toISOString();
    const claimed = await many<PgCollectionJobRow>(
      this.q,
      `SELECT * FROM collection_jobs WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < $1`,
      [now]
    );
    for (const job of claimed) {
      await this.q.query(
        `UPDATE collection_jobs SET status = 'queued', updated_at = $1,
         lease_owner_id = NULL, lease_owner_instance_id = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL
         WHERE id = $2 AND status = 'claimed'`,
        [now, job.id]
      );
      emitDomainEvent("collection_job.lease_lost", {
        job_id: job.id, source_id: job.source_id, requeued: true, occurred_at: now,
      });
    }
    const running = await many<PgCollectionJobRow>(
      this.q,
      `SELECT * FROM collection_jobs WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < $1`,
      [now]
    );
    for (const job of running) {
      await this.q.query(
        `UPDATE collection_jobs SET
          status = 'expired',
          error_code = 'lease_lost',
          error_message = 'Lease expired while running; create a new job to retry.',
          finished_at = $1,
          updated_at = $2,
          lease_owner_id = NULL,
          lease_owner_instance_id = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL
         WHERE id = $3 AND status = 'running'`,
        [now, now, job.id]
      );
      emitDomainEvent("collection_job.expired", {
        job_id: job.id, source_id: job.source_id, error_code: "lease_lost", occurred_at: now,
      });
    }
    return claimed.length + running.length;
  }

  async listNextForAgent(sourceId: string, registrationId: string, limit: number): Promise<ListNextQueuedJobsResult> {
    const source = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [sourceId]);
    const registration = await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE source_id = $1", [sourceId]);
    if (!source || !registration || registration.id !== registrationId) return { jobs: [], gate: "source_disabled" };
    const rows = await many<PgCollectionJobRow>(
      this.q,
      `SELECT * FROM collection_jobs WHERE source_id = $1 AND status = 'queued' ORDER BY created_at ASC`,
      [sourceId]
    );

    return buildListNextQueuedJobsResult({
      sourceEnabled: source.enabled,
      lastHeartbeatAt: registration.last_heartbeat_at,
      agentCapabilities: parseJson<string[]>(registration.last_capabilities_json, []),
      sourceCapabilities: parseJson<string[]>(source.capabilities_json, []),
      queuedJobs: rows.map((job) => ({
        id: job.id,
        source_id: job.source_id,
        artifact_type: job.artifact_type,
        status: job.status,
        created_at: job.created_at,
        request_reason: job.request_reason,
        collection_scope: parseCollectionScopeJson(job.collection_scope_json),
      })),
      limit,
    });
  }

  async listNextForAgentAfterLeaseReap(
    sourceId: string,
    registrationId: string,
    limit: number
  ): Promise<ListNextQueuedJobsResult> {
    await this.reapExpiredLeases();
    return this.listNextForAgent(sourceId, registrationId, limit);
  }

  async claimForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    leaseTtlSeconds: number
  ): ReturnType<JobsStore["claimForAgent"]> {
    const job = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [jobId]);
    if (!job) return { ok: false as const, code: "not_found" };
    const claimValidation = validateClaimCommand(job, { sourceId });
    if (!claimValidation.ok) return { ok: false as const, code: claimValidation.code };
    const { claimedAt, leaseExpiresAt } = buildClaimLease(leaseTtlSeconds);
    const res = await this.q.query(
      `UPDATE collection_jobs SET
        status = 'claimed',
        lease_owner_id = $1,
        lease_owner_instance_id = $2,
        lease_expires_at = $3,
        claimed_at = $4,
        updated_at = $5,
        last_heartbeat_at = NULL
       WHERE id = $6 AND source_id = $7 AND status = 'queued'`,
      [registrationId, instanceId, leaseExpiresAt, claimedAt, claimedAt, jobId, sourceId]
    );
    const claimed = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [jobId]);
    if (res.rowCount === 0 || !claimed || claimed.lease_owner_instance_id !== instanceId) {
      return { ok: false as const, code: "not_queued" };
    }
    await this.q.query("UPDATE agent_registrations SET last_instance_id = $1 WHERE id = $2", [instanceId, registrationId]);
    emitDomainEvent("collection_job.claimed", {
      job_id: jobId, lease_owner_id: registrationId, lease_expires_at: leaseExpiresAt, occurred_at: claimedAt,
    });
    return { ok: true as const, row: jobToView(claimed) };
  }

  async startForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string
  ): ReturnType<JobsStore["startForAgent"]> {
    const job = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [jobId]);
    if (!job || job.source_id !== sourceId) return { ok: false as const, code: "wrong_job" };
    const nowIso = new Date().toISOString();
    const startValidation = validateStartCommand(
      job,
      {
        sourceId,
        registrationId,
        instanceId,
      },
      nowIso
    );
    if (!startValidation.ok) return { ok: false as const, code: startValidation.code };
    const expires = buildStartLeaseExpiryIso(nowIso);
    const res = await this.q.query(
      `UPDATE collection_jobs SET
        status = 'running',
        started_at = $1,
        lease_expires_at = $2,
        updated_at = $3
       WHERE id = $4 AND status = 'claimed'
         AND lease_owner_id = $5 AND lease_owner_instance_id = $6
         AND lease_expires_at > $7`,
      [nowIso, expires, nowIso, jobId, registrationId, instanceId, nowIso]
    );
    const row = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [jobId]);
    if (res.rowCount === 0 || !row || row.status !== "running") return { ok: false as const, code: "not_claimed" };
    emitDomainEvent("collection_job.running", { job_id: jobId, occurred_at: nowIso });
    return { ok: true as const, row: jobToView(row) };
  }

  async failForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    errorCode: string,
    errorMessage: string
  ): ReturnType<JobsStore["failForAgent"]> {
    const job = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [jobId]);
    if (!job || job.source_id !== sourceId) return { ok: false as const, code: "wrong_job" };
    const nowIso = new Date().toISOString();
    const failValidation = validateFailCommand(
      job,
      {
        sourceId,
        registrationId,
        instanceId,
      },
      nowIso
    );
    if (!failValidation.ok) return { ok: false as const, code: failValidation.code };
    const { errorCode: code, errorMessage: msg } = normalizeAgentFailureInput(
      errorCode,
      errorMessage
    );
    const res = await this.q.query(
      `UPDATE collection_jobs SET
        status = 'failed',
        error_code = $1,
        error_message = $2,
        finished_at = $3,
        updated_at = $4,
        lease_owner_id = NULL,
        lease_owner_instance_id = NULL,
        lease_expires_at = NULL,
        last_heartbeat_at = NULL
       WHERE id = $5 AND source_id = $6
         AND status IN ('claimed', 'running')
         AND lease_owner_id = $7 AND lease_owner_instance_id = $8
         AND lease_expires_at > $9`,
      [code, msg, nowIso, nowIso, jobId, sourceId, registrationId, instanceId, nowIso]
    );
    const row = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [jobId]);
    if (res.rowCount === 0 || !row || row.status !== "failed") return { ok: false as const, code: "bad_state" };
    emitDomainEvent("collection_job.failed", { job_id: jobId, error_code: code, error_message: msg, occurred_at: nowIso });
    return { ok: true as const, row: jobToView(row) };
  }

  async submitArtifactForAgent(input: Parameters<JobsStore["submitArtifactForAgent"]>[0]): ReturnType<JobsStore["submitArtifactForAgent"]> {
    const job = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [input.jobId]);
    if (!job) return { ok: false as const, code: "not_found" };
    const validation = validateAgentSubmissionState(job, {
      sourceId: input.sourceId,
      registrationId: input.registrationId,
      instanceId: input.instanceId,
      artifactType: input.artifactType,
    });
    if (!validation.ok) return validation;
    const nowIso = new Date().toISOString();
    const artifact = await insertArtifactPg(this.q, {
      artifact_type: input.artifactType,
      source_type: input.sourceType,
      filename: input.filename,
      content: input.content,
    });
    const run = await insertRunPg(
      this.q,
      artifact.id,
      input.analysis,
      toRunSubmissionMeta({
        filename: input.filename,
        sourceType: input.sourceType,
        ingestion: input.ingestion,
      })
    );
    const res = await this.q.query(
      `UPDATE collection_jobs SET
        status = 'submitted',
        result_artifact_id = $1,
        result_run_id = $2,
        result_analysis_status = $3,
        submitted_at = $4,
        finished_at = $5,
        updated_at = $6,
        lease_owner_id = NULL,
        lease_owner_instance_id = NULL,
        lease_expires_at = NULL,
        last_heartbeat_at = NULL
       WHERE id = $7 AND source_id = $8
         AND status = 'running'
         AND lease_owner_id = $9 AND lease_owner_instance_id = $10
         AND lease_expires_at > $11`,
      [artifact.id, run.id, run.status, nowIso, nowIso, nowIso, input.jobId, input.sourceId, input.registrationId, input.instanceId, nowIso]
    );
    if (res.rowCount === 0) {
      await this.q.query("DELETE FROM runs WHERE id = $1", [run.id]);
      await this.q.query("DELETE FROM artifacts WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM runs WHERE artifact_id = $1)", [artifact.id]);
      return { ok: false as const, code: "conflict" };
    }
    emitDomainEvent("collection_job.submitted", { job_id: input.jobId, artifact_id: artifact.id, run_id: run.id, occurred_at: nowIso });
    const submitted = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [input.jobId]);
    return { ok: true as const, job: jobToView(submitted!), run_id: run.id, artifact_id: artifact.id, run_status: run.status };
  }
}

class PostgresAgentsStore implements AgentsStore {
  constructor(private readonly q: Queryable) {}

  async getRegistrationBySourceId(sourceId: string) {
    return one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE source_id = $1", [sourceId]);
  }

  async resolveRequestContextByTokenHash(tokenHash: string) {
    const registration = await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE token_hash = $1", [tokenHash]);
    if (!registration) return null;
    const source = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [registration.source_id]);
    if (!source) return null;
    return { registration, source: sourceToView(source) };
  }

  async createRegistration(sourceId: string, displayName?: string | null): Promise<AgentRegistrationCreated> {
    const source = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [sourceId]);
    if (!source) {
      const err = new Error("source_not_found");
      (err as Error & { code: string }).code = "source_not_found";
      throw err;
    }
    const existing = await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE source_id = $1", [sourceId]);
    if (existing) {
      const err = new Error("already_registered");
      (err as Error & { code: string }).code = "source_already_registered";
      throw err;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const plainToken = generateAgentToken();
    const tokenHash = hashAgentToken(plainToken);
    const token_prefix = plainToken.slice(0, 8);
    await this.q.query(
      `INSERT INTO agent_registrations (id, source_id, token_hash, display_name, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, sourceId, tokenHash, displayName?.trim() ?? null, now]
    );
    return {
      row: (await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE id = $1", [id]))!,
      plainToken,
      token_prefix,
    };
  }

  async rotateRegistration(sourceId: string): Promise<AgentRegistrationCreated> {
    const source = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [sourceId]);
    if (!source) {
      const err = new Error("source_not_found");
      (err as Error & { code: string }).code = "source_not_found";
      throw err;
    }
    const existing = await one<PgAgentRegistrationRow>(
      this.q,
      "SELECT * FROM agent_registrations WHERE source_id = $1",
      [sourceId]
    );
    if (!existing) {
      const err = new Error("registration_not_found");
      (err as Error & { code: string }).code = "registration_not_found";
      throw err;
    }

    const plainToken = generateAgentToken();
    const tokenHash = hashAgentToken(plainToken);
    const token_prefix = plainToken.slice(0, 8);
    await this.q.query("UPDATE agent_registrations SET token_hash = $1 WHERE id = $2", [
      tokenHash,
      existing.id,
    ]);
    return {
      row: (await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE id = $1", [
        existing.id,
      ]))!,
      plainToken,
      token_prefix,
    };
  }

  async applyHeartbeat(input: Parameters<AgentsStore["applyHeartbeat"]>[0]): ReturnType<AgentsStore["applyHeartbeat"]> {
    const source = await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [input.sourceId]);
    if (!source) return { ok: false as const, code: "source_not_found" };
    const registration = await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE source_id = $1", [input.sourceId]);
    if (!registration || registration.id !== input.registrationId) return { ok: false as const, code: "registration_not_found" };

    const now = new Date().toISOString();
    const nowMs = Date.now();
    let activeJob: PgCollectionJobRow | null = null;
    if (input.activeJobId) {
      activeJob = await one<PgCollectionJobRow>(this.q, "SELECT * FROM collection_jobs WHERE id = $1", [input.activeJobId]);
      if (!activeJob) return { ok: false as const, code: "active_job_not_found" };
      const activeJobValidation = validateHeartbeatActiveJob(
        activeJob,
        {
          sourceId: source.id,
          registrationId: registration.id,
          instanceId: input.instanceId,
        },
        now
      );
      if (!activeJobValidation.ok) {
        return { ok: false as const, code: activeJobValidation.code };
      }
    }

    let active_job_lease: ApplyAgentHeartbeatResult["active_job_lease"] = { requested: false };
    const prevHealth = source.health_status;
    await this.q.query(
      `UPDATE sources SET last_seen_at = $1, health_status = 'online', attributes_json = $2, updated_at = $3 WHERE id = $4`,
      [
        now,
        mergeHeartbeatAttributesJson(source.attributes_json, input.attributes),
        now,
        source.id,
      ]
    );
    await this.q.query(
      `UPDATE agent_registrations SET last_capabilities_json = $1, last_heartbeat_at = $2, last_agent_version = $3 WHERE id = $4`,
      [
        JSON.stringify(input.capabilities),
        now,
        normalizeHeartbeatAgentVersion(input.agentVersion),
        registration.id,
      ]
    );
    if (prevHealth !== "online") {
      emitDomainEvent("source.health_changed", {
        source_id: source.id, previous_health: prevHealth, health_status: "online", occurred_at: now,
      });
    }
    if (input.activeJobId && input.instanceId && activeJob) {
      const previousLeaseExpiry = activeJob.lease_expires_at!;
      const newExp = buildHeartbeatLeaseExpiryIso(activeJob, nowMs);
      const res = await this.q.query(
        `UPDATE collection_jobs SET lease_expires_at = $1, last_heartbeat_at = $2, updated_at = $3
         WHERE id = $4 AND source_id = $5 AND status IN ('claimed', 'running')
           AND lease_owner_id = $6 AND lease_owner_instance_id = $7 AND lease_expires_at = $8`,
        [newExp, now, now, activeJob.id, source.id, registration.id, input.instanceId, previousLeaseExpiry]
      );
      active_job_lease =
        res.rowCount === 1 ?
          { requested: true, job_id: activeJob.id, extended: true, lease_expires_at: newExp }
        : { requested: true, job_id: activeJob.id, extended: false, code: "lease_not_extended" };
    }
    const updatedSource = (await one<PgSourceRow>(this.q, "SELECT * FROM sources WHERE id = $1", [source.id]))!;
    const updatedReg = (await one<PgAgentRegistrationRow>(this.q, "SELECT * FROM agent_registrations WHERE id = $1", [registration.id]))!;
    return {
      ok: true as const,
      result: {
        source: sourceToHeartbeatRow(updatedSource),
        registration: registrationToHeartbeatRow(updatedReg),
        active_job_lease,
      },
    };
  }

  async applyHeartbeatAfterLeaseReap(
    input: Parameters<AgentsStore["applyHeartbeatAfterLeaseReap"]>[0]
  ): ReturnType<AgentsStore["applyHeartbeatAfterLeaseReap"]> {
    await new PostgresJobsStore(this.q).reapExpiredLeases();
    return this.applyHeartbeat(input);
  }
}

let pool: Pool | null = null;

function getPool() {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgres");
  pool = new Pool({ connectionString: databaseUrl });
  return pool;
}

class PostgresStorage implements Storage {
  readonly runs: RunsStore;
  readonly sources: SourcesStore;
  readonly jobs: JobsStore;
  readonly agents: AgentsStore;
  private readonly pool: Pool;

  constructor(q: Queryable, poolOverride?: Pool) {
    this.runs = new PostgresRunsStore(q);
    this.sources = new PostgresSourcesStore(q);
    this.jobs = new PostgresJobsStore(q);
    this.agents = new PostgresAgentsStore(q);
    this.pool = poolOverride ?? (q as Pool);
  }

  async withTransaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = new PostgresStorage(client, this.pool);
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function getPostgresStorage(): Promise<Storage> {
  const p = getPool();
  return new PostgresStorage(p, p);
}

/**
 * Create a test Postgres storage with an isolated schema. Returns the storage
 * and a teardown function that drops the schema and closes the pool.
 * Requires DATABASE_URL_TEST (or DATABASE_URL) pointing at a real Postgres.
 */
export async function getTestPostgresStorage(): Promise<{
  storage: Storage;
  teardown: () => Promise<void>;
}> {
  const url = process.env.DATABASE_URL_TEST?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_TEST or DATABASE_URL required for Postgres parity tests");
  const schema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const testPool = new Pool({ connectionString: url });
  await testPool.query(`CREATE SCHEMA "${schema}"`);
  await testPool.query(`SET search_path TO "${schema}"`);

  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), "migrations", "postgres");
  const files = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
  const client = await testPool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("BEGIN");
    for (const file of files) {
      await client.query(readFileSync(join(dir, file), "utf8"));
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }

  const originalConnect = testPool.connect.bind(testPool);
  const wrappedPool: Pool = Object.assign(Object.create(testPool), {
    query: (...args: unknown[]) => (testPool.query as Function).apply(testPool, args),
    connect: async () => {
      const c = await originalConnect();
      await c.query(`SET search_path TO "${schema}"`);
      return c;
    },
  }) as Pool;
  await testPool.query(`SET search_path TO "${schema}"`);

  const storage = new PostgresStorage(wrappedPool, wrappedPool);

  return {
    storage,
    teardown: async () => {
      await testPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await testPool.end();
    },
  };
}
