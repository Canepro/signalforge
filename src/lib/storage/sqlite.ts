import type { Database } from "sql.js";
import { randomUUID } from "node:crypto";
import { getDb, reloadDbFromDisk, saveDb, withDbFileLock } from "@/lib/db/client";
import {
  deleteArtifactIfUnreferenced,
  deleteRunById,
  getArtifactById,
  getRun,
  getRunWithArtifact,
  insertArtifact,
  insertRun,
  listRuns,
  submissionMetaFromRun,
} from "@/lib/db/repository";
import { buildCompareDriftPayload } from "@/lib/compare/build-compare";
import { buildRunDetail, toRunDetailJson } from "@/lib/api/run-detail-json";
import type {
  AgentsStore,
  AutomationSignalsStore,
  AutomationAgentsStore,
  AutomationSignalView,
  CollectionJobView,
  FixActionRunsStore,
  FixActionRunView,
  JobsStore,
  PersistAnalyzedRunInput,
  PersistAnalyzedRunResult,
  ReanalyzeSourceResult,
  RunsStore,
  SourcesStore,
  Storage,
  StorageTx,
} from "./contract";
import type { Finding } from "@/lib/analyzer/schema";
import { KUBERNETES_SAFE_FIX_CAPABILITY } from "@/lib/automation/fix-policy";
import {
  mapRunSummaryRow,
  parseFindingsFromReportJson,
  runAttentionScore,
  toRunSubmissionMeta,
  validateAgentSubmissionState,
} from "./shared/run-shared";
import { validateHeartbeatActiveJob } from "./shared/agent-lifecycle-shared";
import { projectCollectionJobLeaseReadModel } from "./shared/job-read-model";
import {
  applyAgentHeartbeat,
  claimCollectionJobForAgent,
  cancelCollectionJob,
  collectionJobToJson,
  createAgentRegistration,
  createAutomationAgentRegistration,
  deleteSource,
  failCollectionJobForAgent,
  getAgentRegistrationBySourceId,
  getAgentRegistrationByTokenHash,
  getAutomationAgentRegistrationBySourceId,
  getAutomationAgentRegistrationByTokenHash,
  getCollectionJobById,
  getSourceById,
  insertCollectionJob,
  insertSource,
  listNextQueuedJobSummariesForSource,
  listCollectionJobsForSource,
  listSources,
  markCollectionJobSubmittedForAgent,
  reapExpiredCollectionJobLeases,
  rotateAgentRegistrationToken,
  startCollectionJobForAgent,
  sourceToJson,
  updateSource,
} from "@/lib/db/source-job-repository";

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getOne<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject() as unknown as T;
  stmt.free();
  return row;
}

function allRows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
  stmt.free();
  return rows;
}

type AutomationSignalRow = AutomationSignalView;

type FixActionRunRow = Omit<FixActionRunView, "action_payload" | "dry_run_summary" | "apply_summary"> & {
  action_payload_json: string;
  dry_run_summary_json: string | null;
  apply_summary_json: string | null;
};

function signalToView(row: AutomationSignalRow): AutomationSignalView {
  return row;
}

function fixActionToView(row: FixActionRunRow): FixActionRunView {
  const { action_payload_json, dry_run_summary_json, apply_summary_json, ...rest } = row;
  const legacyPayload = { kind: "legacy_unavailable" } as unknown as FixActionRunView["action_payload"];
  return {
    ...rest,
    action_payload: parseJson(action_payload_json, legacyPayload),
    dry_run_summary: parseJson<Record<string, unknown> | null>(dry_run_summary_json, null),
    apply_summary: parseJson<Record<string, unknown> | null>(apply_summary_json, null),
  };
}

function actionableSignalFindings(findings: Finding[]): Finding[] {
  return findings.filter(
    (finding) =>
      ["critical", "high"].includes(finding.severity) &&
      finding.title.toLowerCase().includes("automatically mounts service account tokens")
  );
}

function signalDedupeKey(sourceId: string, artifactType: string, finding: Finding): string {
  return [sourceId, artifactType, finding.id, finding.title].join("|");
}

function isLeaseValid(row: { lease_expires_at: string | null }, nowIso: string): boolean {
  return Boolean(row.lease_expires_at && row.lease_expires_at > nowIso);
}

class SqliteRunsStore implements RunsStore {
  constructor(private readonly db: Database) {}

  async listSummaries() {
    return listRuns(this.db);
  }

  async countRuns() {
    const stmt = this.db.prepare("SELECT COUNT(*) AS total FROM runs");
    stmt.step();
    const row = stmt.getAsObject() as { total: number };
    stmt.free();
    return Number(row.total ?? 0);
  }

  async listDashboardRecentRuns(limit: number) {
    const cappedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const stmt = this.db.prepare(
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON r.artifact_id = a.id
       ORDER BY r.created_at DESC
       LIMIT ?`
    );
    stmt.bind([cappedLimit]);

    const out = [] as ReturnType<RunsStore["listDashboardRecentRuns"]> extends Promise<infer T> ? T : never;
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
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
      };
      out.push(mapRunSummaryRow(row));
    }
    stmt.free();
    return out;
  }

  async listDashboardWindowRuns(sinceIso: string) {
    const stmt = this.db.prepare(
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON r.artifact_id = a.id
       WHERE r.created_at >= ?
       ORDER BY r.created_at DESC`
    );
    stmt.bind([sinceIso]);

    const out = [] as ReturnType<RunsStore["listDashboardWindowRuns"]> extends Promise<infer T> ? T : never;
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
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
      };
      out.push(mapRunSummaryRow(row));
    }
    stmt.free();
    return out;
  }

  async listDashboardSignalRuns(limit: number) {
    const cappedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const scanLimit = Math.min(1000, Math.max(200, cappedLimit * 200));
    const stmt = this.db.prepare(
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON r.artifact_id = a.id
       WHERE r.report_json IS NOT NULL
       ORDER BY r.created_at DESC
       LIMIT ?`
    );
    stmt.bind([scanLimit]);

    const out: Awaited<ReturnType<RunsStore["listDashboardSignalRuns"]>> = [];
    while (stmt.step() && out.length < cappedLimit) {
      const row = stmt.getAsObject() as {
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
      };
      const run = mapRunSummaryRow(row);
      if (runAttentionScore(run) <= 0) continue;
      const findings = parseFindingsFromReportJson(row.report_json);
      if (findings.length === 0) continue;
      out.push({ run, findings });
    }
    stmt.free();

    return out;
  }

  async countSuppressedNoise() {
    const stmt = this.db.prepare("SELECT noise_json FROM runs WHERE noise_json IS NOT NULL");
    let total = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject() as { noise_json: string | null };
      if (!row.noise_json) continue;
      try {
        const items = JSON.parse(row.noise_json);
        if (Array.isArray(items)) total += items.length;
      } catch {
        /* skip malformed rows */
      }
    }
    stmt.free();
    return total;
  }

  async getApiDetail(id: string) {
    const row = getRunWithArtifact(this.db, id);
    return row ? toRunDetailJson(row) : null;
  }

  async getPageDetail(id: string) {
    const row = getRunWithArtifact(this.db, id);
    if (!row) return null;
    const parent =
      row.parent_run_id ? getRun(this.db, row.parent_run_id) : null;
    return buildRunDetail(
      row,
      parent ? { id: parent.id, filename: parent.filename } : null,
      row.artifact_content
    );
  }

  async getReport(id: string) {
    const run = getRun(this.db, id);
    if (!run?.report_json) return null;
    return JSON.parse(run.report_json);
  }

  async getComparePayload(id: string, against?: string | null) {
    return buildCompareDriftPayload(this.db, id, against);
  }

  async getReanalyzeSource(parentRunId: string): Promise<ReanalyzeSourceResult> {
    const run = getRun(this.db, parentRunId);
    if (!run) return { ok: false, error: "run_not_found" };
    const artifact = getArtifactById(this.db, run.artifact_id);
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
    const artifact = insertArtifact(this.db, {
      artifact_type: input.artifactType,
      source_type: input.sourceType,
      filename: input.filename,
      content: input.content,
    });

    const run = insertRun(
      this.db,
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

class SqliteSourcesStore implements SourcesStore {
  constructor(private readonly db: Database) {}

  async list(opts?: { enabled?: boolean }) {
    return listSources(this.db, opts).map(sourceToJson);
  }

  async listDashboardCollectionSourceStates(opts?: { enabled?: boolean }) {
    const whereClause =
      opts?.enabled === true ? "WHERE s.enabled = 1"
      : opts?.enabled === false ? "WHERE s.enabled = 0"
      : "";

    const stmt = this.db.prepare(
      `SELECT s.*,
              EXISTS(
                SELECT 1
                FROM agent_registrations ar
                WHERE ar.source_id = s.id
              ) AS has_registration
       FROM sources s
       ${whereClause}
       ORDER BY s.created_at DESC`
    );

    const out: Awaited<ReturnType<SourcesStore["listDashboardCollectionSourceStates"]>> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as Parameters<typeof sourceToJson>[0] & {
        has_registration: number | boolean;
      };
      out.push({
        source: sourceToJson(row),
        hasRegistration: Boolean(row.has_registration),
      });
    }
    stmt.free();
    return out;
  }

  async getById(id: string) {
    const row = getSourceById(this.db, id);
    return row ? sourceToJson(row) : null;
  }

  async create(input: Parameters<typeof insertSource>[1]) {
    return sourceToJson(insertSource(this.db, input));
  }

  async update(id: string, patch: Parameters<typeof updateSource>[2]) {
    const row = updateSource(this.db, id, patch);
    return row ? sourceToJson(row) : null;
  }

  async delete(id: string) {
    return deleteSource(this.db, id);
  }
}

class SqliteJobsStore implements JobsStore {
  constructor(private readonly db: Database) {}

  async listForSource(sourceId: string, opts?: { status?: string }) {
    const projected = listCollectionJobsForSource(this.db, sourceId)
      .map(collectionJobToJson)
      .map((job) => projectCollectionJobLeaseReadModel(job));

    return opts?.status ? projected.filter((job) => job.status === opts.status) : projected;
  }

  async getById(id: string) {
    const row = getCollectionJobById(this.db, id);
    return row ? projectCollectionJobLeaseReadModel(collectionJobToJson(row)) : null;
  }

  async queueForSource(sourceId: string, input: Parameters<typeof insertCollectionJob>[2]) {
    const source = getSourceById(this.db, sourceId);
    if (!source) {
      const err = new Error("source_not_found");
      (err as Error & { code: string }).code = "source_not_found";
      throw err;
    }
    const { row, inserted } = insertCollectionJob(this.db, source, input);
    return { row: collectionJobToJson(row), inserted };
  }

  async cancel(id: string) {
    const row = cancelCollectionJob(this.db, id);
    return row ? collectionJobToJson(row) : null;
  }

  async reapExpiredLeases() {
    return reapExpiredCollectionJobLeases(this.db);
  }

  async listNextForAgent(sourceId: string, registrationId: string, limit: number) {
    const source = getSourceById(this.db, sourceId);
    const registration = getAgentRegistrationBySourceId(this.db, sourceId);
    if (!source || !registration || registration.id !== registrationId) {
      return { jobs: [], gate: "source_disabled" as const };
    }
    return listNextQueuedJobSummariesForSource(this.db, source, registration, limit);
  }

  async listNextForAgentAfterLeaseReap(sourceId: string, registrationId: string, limit: number) {
    await this.reapExpiredLeases();
    return this.listNextForAgent(sourceId, registrationId, limit);
  }

  async claimForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    leaseTtlSeconds: number
  ) {
    const result = claimCollectionJobForAgent(
      this.db,
      jobId,
      sourceId,
      registrationId,
      instanceId,
      leaseTtlSeconds
    );
    return result.ok ? { ok: true as const, row: collectionJobToJson(result.row) } : result;
  }

  async startForAgent(jobId: string, sourceId: string, registrationId: string, instanceId: string) {
    const result = startCollectionJobForAgent(
      this.db,
      jobId,
      sourceId,
      registrationId,
      instanceId
    );
    return result.ok ? { ok: true as const, row: collectionJobToJson(result.row) } : result;
  }

  async failForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    errorCode: string,
    errorMessage: string
  ) {
    const result = failCollectionJobForAgent(
      this.db,
      jobId,
      sourceId,
      registrationId,
      instanceId,
      errorCode,
      errorMessage
    );
    return result.ok ? { ok: true as const, row: collectionJobToJson(result.row) } : result;
  }

  async submitArtifactForAgent(input: {
    jobId: string;
    sourceId: string;
    registrationId: string;
    instanceId: string;
    artifactType: string;
    sourceType: string;
    filename: string;
    content: string;
    ingestion: PersistAnalyzedRunInput["ingestion"];
    analysis: PersistAnalyzedRunInput["analysis"];
  }): ReturnType<JobsStore["submitArtifactForAgent"]> {
    const job = getCollectionJobById(this.db, input.jobId);
    if (!job) return { ok: false as const, code: "not_found" };
    const validation = validateAgentSubmissionState(job, {
      sourceId: input.sourceId,
      registrationId: input.registrationId,
      instanceId: input.instanceId,
      artifactType: input.artifactType,
    });
    if (!validation.ok) {
      return validation;
    }

    const artifact = insertArtifact(this.db, {
      artifact_type: input.artifactType,
      source_type: input.sourceType,
      filename: input.filename,
      content: input.content,
    });
    const run = insertRun(
      this.db,
      artifact.id,
      input.analysis,
      toRunSubmissionMeta({
        filename: input.filename,
        sourceType: input.sourceType,
        ingestion: input.ingestion,
      })
    );

    const submitted = markCollectionJobSubmittedForAgent(
      this.db,
      input.jobId,
      input.sourceId,
      input.registrationId,
      input.instanceId,
      artifact.id,
      run.id,
      run.status
    );

    if (!submitted) {
      deleteRunById(this.db, run.id);
      deleteArtifactIfUnreferenced(this.db, artifact.id);
      return { ok: false as const, code: "conflict" };
    }

    if (run.status === "complete" && input.artifactType === "kubernetes-bundle") {
      const findings = input.analysis.report?.findings ?? [];
      await new SqliteAutomationSignalsStore(this.db).upsertFromRun({
        sourceId: input.sourceId,
        runId: run.id,
        artifactType: input.artifactType,
        findings,
      });
      if (job.requested_by.startsWith("fix_action_run:")) {
        const actionRunId = job.requested_by.slice("fix_action_run:".length);
        await new SqliteFixActionRunsStore(this.db).linkPostFixRun({
          actionRunId,
          sourceId: input.sourceId,
          runId: run.id,
          findings,
        });
      }
    }

    return {
      ok: true as const,
      job: collectionJobToJson(submitted),
      run_id: run.id,
      artifact_id: artifact.id,
      run_status: run.status,
    };
  }
}

class SqliteAgentsStore implements AgentsStore {
  constructor(private readonly db: Database) {}

  async getRegistrationBySourceId(sourceId: string) {
    return getAgentRegistrationBySourceId(this.db, sourceId);
  }

  async resolveRequestContextByTokenHash(tokenHash: string) {
    const registration = getAgentRegistrationByTokenHash(this.db, tokenHash);
    if (!registration) return null;
    const source = getSourceById(this.db, registration.source_id);
    if (!source) return null;
    return { registration, source: sourceToJson(source) };
  }

  async createRegistration(sourceId: string, displayName?: string | null) {
    return createAgentRegistration(this.db, sourceId, displayName);
  }

  async rotateRegistration(sourceId: string) {
    return rotateAgentRegistrationToken(this.db, sourceId);
  }

  async applyHeartbeat(input: {
    sourceId: string;
    registrationId: string;
    capabilities: string[];
    attributes: Record<string, unknown>;
    agentVersion: string;
    activeJobId: string | null;
    instanceId: string | null;
  }): ReturnType<AgentsStore["applyHeartbeat"]> {
    const source = getSourceById(this.db, input.sourceId);
    if (!source) return { ok: false as const, code: "source_not_found" };
    const registration = getAgentRegistrationBySourceId(this.db, input.sourceId);
    if (!registration || registration.id !== input.registrationId) {
      return { ok: false as const, code: "registration_not_found" };
    }

    if (input.activeJobId) {
      const job = getCollectionJobById(this.db, input.activeJobId);
      if (!job) return { ok: false as const, code: "active_job_not_found" };
      const activeJobValidation = validateHeartbeatActiveJob(job, {
        sourceId: source.id,
        registrationId: registration.id,
        instanceId: input.instanceId,
      });
      if (!activeJobValidation.ok) {
        return { ok: false as const, code: activeJobValidation.code };
      }
    }

    return {
      ok: true as const,
      result: applyAgentHeartbeat(this.db, registration, source, {
        capabilities: input.capabilities,
        attributes: input.attributes,
        agent_version: input.agentVersion,
        active_job_id: input.activeJobId,
        instance_id: input.instanceId,
      }),
    };
  }

  async applyHeartbeatAfterLeaseReap(
    input: Parameters<AgentsStore["applyHeartbeatAfterLeaseReap"]>[0]
  ): ReturnType<AgentsStore["applyHeartbeatAfterLeaseReap"]> {
    reapExpiredCollectionJobLeases(this.db);
    return this.applyHeartbeat(input);
  }
}

class SqliteAutomationAgentsStore implements AutomationAgentsStore {
  constructor(private readonly db: Database) {}

  async getRegistrationBySourceId(sourceId: string) {
    return getAutomationAgentRegistrationBySourceId(this.db, sourceId);
  }

  async resolveRequestContextByTokenHash(tokenHash: string) {
    const registration = getAutomationAgentRegistrationByTokenHash(this.db, tokenHash);
    if (!registration) return null;
    const source = getSourceById(this.db, registration.source_id);
    if (!source) return null;
    return { registration, source: sourceToJson(source) };
  }

  async createRegistration(sourceId: string, displayName?: string | null) {
    return createAutomationAgentRegistration(this.db, sourceId, displayName);
  }
}

class SqliteAutomationSignalsStore implements AutomationSignalsStore {
  constructor(private readonly db: Database) {}

  async listNextForSource(sourceId: string, limit: number) {
    return allRows<AutomationSignalRow>(
      this.db,
      `SELECT * FROM automation_signals
       WHERE source_id = ? AND status = 'open'
       ORDER BY last_seen_at DESC
       LIMIT ?`,
      [sourceId, Math.min(50, Math.max(1, Math.floor(limit)))]
    ).map(signalToView);
  }

  async getById(id: string) {
    const row = getOne<AutomationSignalRow>(this.db, "SELECT * FROM automation_signals WHERE id = ?", [id]);
    return row ? signalToView(row) : null;
  }

  async markDiagnosticRequested(id: string, sourceId: string) {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE automation_signals
       SET status = 'diagnostic_requested', updated_at = ?
       WHERE id = ? AND source_id = ? AND status = 'open'`,
      [now, id, sourceId]
    );
    return this.getById(id);
  }

  async upsertFromRun(input: {
    sourceId: string;
    runId: string;
    artifactType: string;
    findings: Finding[];
  }) {
    const now = new Date().toISOString();
    const out: AutomationSignalView[] = [];
    for (const finding of actionableSignalFindings(input.findings)) {
      const dedupeKey = signalDedupeKey(input.sourceId, input.artifactType, finding);
      const existing = getOne<AutomationSignalRow>(
        this.db,
        "SELECT * FROM automation_signals WHERE dedupe_key = ?",
        [dedupeKey]
      );
      if (existing) {
        this.db.run(
          `UPDATE automation_signals
           SET run_id = ?, severity = ?, category = ?, status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
               updated_at = ?, last_seen_at = ?
           WHERE id = ?`,
          [input.runId, finding.severity, finding.category, now, now, existing.id]
        );
        const updated = await this.getById(existing.id);
        if (updated) out.push(updated);
        continue;
      }
      const id = randomUUID();
      this.db.run(
        `INSERT INTO automation_signals (
          id, source_id, run_id, artifact_type, finding_id, finding_title, severity, category,
          signal_type, status, dedupe_key, created_at, updated_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'top_finding', 'open', ?, ?, ?, ?)`,
        [
          id,
          input.sourceId,
          input.runId,
          input.artifactType,
          finding.id,
          finding.title,
          finding.severity,
          finding.category,
          dedupeKey,
          now,
          now,
          now,
        ]
      );
      const inserted = await this.getById(id);
      if (inserted) out.push(inserted);
    }
    return out;
  }

  async markActionQueued(id: string, sourceId: string) {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE automation_signals
       SET status = 'action_queued', updated_at = ?
       WHERE id = ? AND source_id = ?`,
      [now, id, sourceId]
    );
    return this.getById(id);
  }

  async markResolvedIfFindingAbsent(input: {
    signalId: string;
    sourceId: string;
    runId: string;
    findings: Finding[];
  }) {
    const signal = await this.getById(input.signalId);
    if (!signal || signal.source_id !== input.sourceId) return null;
    if (input.findings.some((finding) => finding.id === signal.finding_id)) return signal;
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE automation_signals
       SET status = 'resolved', run_id = ?, updated_at = ?, last_seen_at = ?
       WHERE id = ? AND source_id = ?`,
      [input.runId, now, now, input.signalId, input.sourceId]
    );
    return this.getById(input.signalId);
  }
}

class SqliteFixActionRunsStore implements FixActionRunsStore {
  constructor(private readonly db: Database) {}

  async getById(id: string) {
    const row = getOne<FixActionRunRow>(this.db, "SELECT * FROM fix_action_runs WHERE id = ?", [id]);
    return row ? fixActionToView(row) : null;
  }

  async listForSource(sourceId: string, limit: number) {
    return allRows<FixActionRunRow>(
      this.db,
      "SELECT * FROM fix_action_runs WHERE source_id = ? ORDER BY created_at DESC LIMIT ?",
      [sourceId, Math.min(100, Math.max(1, Math.floor(limit)))]
    ).map(fixActionToView);
  }

  async create(input: Parameters<FixActionRunsStore["create"]>[0]) {
    if (input.idempotencyKey?.trim()) {
      const existing = getOne<FixActionRunRow>(
        this.db,
        `SELECT * FROM fix_action_runs
         WHERE source_id = ? AND idempotency_key = ?
         ORDER BY created_at DESC LIMIT 1`,
        [input.sourceId, input.idempotencyKey.trim()]
      );
      if (existing) return { row: fixActionToView(existing), inserted: false };
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO fix_action_runs (
        id, source_id, automation_signal_id, diagnostic_request_id, pre_fix_run_id,
        finding_id, policy_id, action_kind, action_payload_json, status, requested_by, idempotency_key,
        created_at, updated_at, queued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      [
        id,
        input.sourceId,
        input.signalId,
        input.diagnosticRequestId,
        input.preFixRunId,
        input.findingId,
        input.policyId,
        input.actionKind,
        JSON.stringify(input.actionPayload),
        input.requestedBy,
        input.idempotencyKey?.trim() ?? null,
        now,
        now,
        now,
      ]
    );
    const row = (await this.getById(id))!;
    await new SqliteAutomationSignalsStore(this.db).markActionQueued(input.signalId, input.sourceId);
    return { row, inserted: true };
  }

  async listNextForAgent(sourceId: string, registrationId: string, limit: number) {
    const source = getSourceById(this.db, sourceId);
    const registration = getAgentRegistrationBySourceId(this.db, sourceId);
    if (!source || !registration || registration.id !== registrationId || !source.enabled) {
      return { actions: [], gate: "source_disabled" as const };
    }
    if (!registration.last_heartbeat_at) return { actions: [], gate: "heartbeat_required" as const };
    const agentCapabilities = parseJson<string[]>(registration.last_capabilities_json, []);
    if (agentCapabilities.length === 0) return { actions: [], gate: "capabilities_empty" as const };
    const sourceCapabilities = parseJson<string[]>(source.capabilities_json, []);
    if (
      !agentCapabilities.includes(KUBERNETES_SAFE_FIX_CAPABILITY) ||
      !sourceCapabilities.includes(KUBERNETES_SAFE_FIX_CAPABILITY)
    ) {
      return { actions: [], gate: "capability_mismatch" as const };
    }
    const actions = allRows<FixActionRunRow>(
      this.db,
      `SELECT * FROM fix_action_runs
       WHERE source_id = ? AND status = 'queued'
       ORDER BY created_at ASC
       LIMIT ?`,
      [sourceId, Math.min(10, Math.max(1, Math.floor(limit)))]
    ).map(fixActionToView);
    return { actions, gate: null };
  }

  async claimForAgent(
    actionRunId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    leaseTtlSeconds: number
  ) {
    const row = getOne<FixActionRunRow>(this.db, "SELECT * FROM fix_action_runs WHERE id = ?", [actionRunId]);
    if (!row) return { ok: false as const, code: "not_found" as const };
    if (row.source_id !== sourceId) return { ok: false as const, code: "wrong_source" as const };
    if (row.status !== "queued") return { ok: false as const, code: "not_queued" as const };
    const now = new Date();
    const claimedAt = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseTtlSeconds * 1000).toISOString();
    this.db.run(
      `UPDATE fix_action_runs
       SET status = 'claimed', lease_owner_id = ?, lease_owner_instance_id = ?,
           lease_expires_at = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND source_id = ? AND status = 'queued'`,
      [registrationId, instanceId, leaseExpiresAt, claimedAt, claimedAt, actionRunId, sourceId]
    );
    const claimed = (await this.getById(actionRunId))!;
    return { ok: true as const, row: claimed };
  }

  async startForAgent(actionRunId: string, sourceId: string, registrationId: string, instanceId: string) {
    const row = getOne<FixActionRunRow>(this.db, "SELECT * FROM fix_action_runs WHERE id = ?", [actionRunId]);
    if (!row || row.source_id !== sourceId) return { ok: false as const, code: "wrong_action" as const };
    const now = new Date().toISOString();
    if (row.status !== "claimed") return { ok: false as const, code: "not_claimed" as const };
    if (row.lease_owner_id !== registrationId || row.lease_owner_instance_id !== instanceId)
      return { ok: false as const, code: "wrong_lease" as const };
    if (!isLeaseValid(row, now)) return { ok: false as const, code: "lease_expired" as const };
    this.db.run(
      `UPDATE fix_action_runs
       SET status = 'dry_running', started_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, actionRunId]
    );
    return { ok: true as const, row: (await this.getById(actionRunId))! };
  }

  async recordDryRun(input: Parameters<FixActionRunsStore["recordDryRun"]>[0]) {
    const row = getOne<FixActionRunRow>(this.db, "SELECT * FROM fix_action_runs WHERE id = ?", [input.actionRunId]);
    if (!row || row.source_id !== input.sourceId) return { ok: false as const, code: "wrong_action" as const };
    const now = new Date().toISOString();
    if (row.status !== "dry_running") return { ok: false as const, code: "bad_state" as const };
    if (row.lease_owner_id !== input.registrationId || row.lease_owner_instance_id !== input.instanceId)
      return { ok: false as const, code: "wrong_lease" as const };
    if (!isLeaseValid(row, now)) return { ok: false as const, code: "lease_expired" as const };
    const nextStatus = input.status === "passed" ? "applying" : "failed";
    this.db.run(
      `UPDATE fix_action_runs
       SET status = ?, dry_run_summary_json = ?, dry_run_at = ?, updated_at = ?,
           error_code = CASE WHEN ? = 'failed' THEN 'dry_run_failed' ELSE error_code END,
           error_message = CASE WHEN ? = 'failed' THEN 'Dry-run failed' ELSE error_message END,
           finished_at = CASE WHEN ? = 'failed' THEN ? ELSE finished_at END
       WHERE id = ?`,
      [
        nextStatus,
        JSON.stringify(input.summary),
        now,
        now,
        input.status,
        input.status,
        input.status,
        now,
        input.actionRunId,
      ]
    );
    return { ok: true as const, row: (await this.getById(input.actionRunId))! };
  }

  async recordApply(input: Parameters<FixActionRunsStore["recordApply"]>[0]) {
    const row = getOne<FixActionRunRow>(this.db, "SELECT * FROM fix_action_runs WHERE id = ?", [input.actionRunId]);
    if (!row || row.source_id !== input.sourceId) return { ok: false as const, code: "wrong_action" as const };
    const now = new Date().toISOString();
    if (row.status !== "applying") return { ok: false as const, code: "bad_state" as const };
    if (row.lease_owner_id !== input.registrationId || row.lease_owner_instance_id !== input.instanceId)
      return { ok: false as const, code: "wrong_lease" as const };
    if (!isLeaseValid(row, now)) return { ok: false as const, code: "lease_expired" as const };
    const failed = input.status === "failed";
    this.db.run(
      `UPDATE fix_action_runs
       SET status = ?, apply_summary_json = ?, applied_at = ?, updated_at = ?, finished_at = ?,
           lease_owner_id = NULL, lease_owner_instance_id = NULL, lease_expires_at = NULL,
           error_code = ?, error_message = ?
       WHERE id = ?`,
      [
        failed ? "failed" : "applied",
        JSON.stringify(input.summary),
        now,
        now,
        failed ? now : null,
        failed ? "apply_failed" : null,
        failed ? "Apply failed" : null,
        input.actionRunId,
      ]
    );
    let postFixJob: CollectionJobView | null = null;
    if (!failed) {
      const source = getSourceById(this.db, input.sourceId)!;
      const queued = insertCollectionJob(this.db, source, {
        requested_by: `fix_action_run:${input.actionRunId}`,
        request_reason: `post-fix verification for ${row.policy_id}`,
      });
      postFixJob = collectionJobToJson(queued.row);
    }
    return { ok: true as const, row: (await this.getById(input.actionRunId))!, postFixJob };
  }

  async linkPostFixRun(input: Parameters<FixActionRunsStore["linkPostFixRun"]>[0]) {
    const row = getOne<FixActionRunRow>(this.db, "SELECT * FROM fix_action_runs WHERE id = ?", [input.actionRunId]);
    if (!row || row.source_id !== input.sourceId) return null;
    const signal = await new SqliteAutomationSignalsStore(this.db).markResolvedIfFindingAbsent({
      signalId: row.automation_signal_id,
      sourceId: input.sourceId,
      runId: input.runId,
      findings: input.findings,
    });
    const now = new Date().toISOString();
    const resolved = signal?.status === "resolved";
    this.db.run(
      `UPDATE fix_action_runs
       SET post_fix_run_id = ?, status = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [input.runId, resolved ? "verified" : "applied", resolved ? now : row.finished_at, now, input.actionRunId]
    );
    return this.getById(input.actionRunId);
  }
}

class SqliteStorage implements Storage {
  constructor(
    private db: Database,
    private readonly fileBacked: boolean = true
  ) {}

  get runs(): RunsStore {
    return new SqliteRunsStore(this.db);
  }

  get sources(): SourcesStore {
    return new SqliteSourcesStore(this.db);
  }

  get jobs(): JobsStore {
    return new SqliteJobsStore(this.db);
  }

  get agents(): AgentsStore {
    return new SqliteAgentsStore(this.db);
  }

  get automationAgents(): AutomationAgentsStore {
    return new SqliteAutomationAgentsStore(this.db);
  }

  get automationSignals(): AutomationSignalsStore {
    return new SqliteAutomationSignalsStore(this.db);
  }

  get fixActionRuns(): FixActionRunsStore {
    return new SqliteFixActionRunsStore(this.db);
  }

  async withTransaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T> {
    if (!this.fileBacked) {
      this.db.run("BEGIN");
      try {
        const result = await fn(this);
        this.db.run("COMMIT");
        return result;
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }
    }

    return withDbFileLock(async () => {
      this.db = await reloadDbFromDisk();
      this.db.run("BEGIN");
      try {
        const result = await fn(this);
        this.db.run("COMMIT");
        saveDb();
        return result;
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }
    });
  }
}

export async function getSqliteStorage(): Promise<Storage> {
  return new SqliteStorage(await getDb());
}

export async function getTestSqliteStorage(): Promise<Storage> {
  const { getTestDb } = await import("@/lib/db/client");
  return new SqliteStorage(await getTestDb(), false);
}
