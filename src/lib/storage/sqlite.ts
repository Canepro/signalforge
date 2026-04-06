import type { Database } from "sql.js";
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
  JobsStore,
  PersistAnalyzedRunInput,
  PersistAnalyzedRunResult,
  ReanalyzeSourceResult,
  RunsStore,
  SourcesStore,
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
import { projectCollectionJobLeaseReadModel } from "./shared/job-read-model";
import {
  applyAgentHeartbeat,
  claimCollectionJobForAgent,
  cancelCollectionJob,
  collectionJobToJson,
  createAgentRegistration,
  deleteSource,
  failCollectionJobForAgent,
  getAgentRegistrationBySourceId,
  getAgentRegistrationByTokenHash,
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

class SqliteRunsStore implements RunsStore {
  constructor(private readonly db: Database) {}

  async listSummaries() {
    return listRuns(this.db);
  }

  async listDashboardSignalRuns(limit: number) {
    const cappedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const stmt = this.db.prepare(
      `SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
              r.created_at, r.status, r.report_json, r.environment_json,
              r.target_identifier, r.collector_type
       FROM runs r
       JOIN artifacts a ON r.artifact_id = a.id
       ORDER BY r.created_at DESC`
    );

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
    return listCollectionJobsForSource(this.db, sourceId, opts)
      .map(collectionJobToJson)
      .map((job) => projectCollectionJobLeaseReadModel(job));
  }

  async getById(id: string) {
    const row = getCollectionJobById(this.db, id);
    return row ? collectionJobToJson(row) : null;
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
      if (job.source_id !== source.id) return { ok: false as const, code: "forbidden" };
      if (job.lease_owner_id !== registration.id) return { ok: false as const, code: "forbidden" };
      if (job.status !== "claimed" && job.status !== "running") {
        return { ok: false as const, code: "invalid_active_job_state" };
      }
      if (!job.lease_owner_instance_id) {
        return { ok: false as const, code: "invalid_state" };
      }
      if (job.lease_owner_instance_id !== input.instanceId) {
        return { ok: false as const, code: "instance_mismatch" };
      }
      const nowIso = new Date().toISOString();
      if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
        return { ok: false as const, code: "lease_expired" };
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
