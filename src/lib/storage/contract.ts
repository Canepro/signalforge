import type { AnalysisResult, AuditReport, Finding } from "@/lib/analyzer/schema";
import type { CompareDriftError, CompareDriftPayload } from "@/lib/compare/build-compare";
import type {
  ActiveJobLeaseHeartbeatResult,
  AgentRegistrationCreated,
  ApplyAgentHeartbeatResult,
  CollectionJobSummary,
  ListNextQueuedJobsResult,
  PatchSourceInput,
} from "@/lib/db/source-job-repository";
import type { RunSubmissionMeta } from "@/lib/db/repository";
import type { CollectionScope } from "@/lib/collection-scope";
import type { ParsedIngestionMeta } from "@/lib/ingestion/meta";
import type { SourceType } from "@/lib/source-catalog";
import type { RunDetail, RunSummary } from "@/types/api";
import type { GetRunDetailResponse } from "@/types/api-contract";

export interface PersistAnalyzedRunInput {
  artifactType: string;
  sourceType: string;
  filename: string;
  content: string;
  ingestion: ParsedIngestionMeta;
  analysis: AnalysisResult;
  parentRunId?: string;
}

export interface PersistAnalyzedRunResult {
  run_id: string;
  artifact_id: string;
  status: string;
  report: AuditReport | null;
}

export type ReanalyzeSourceResult =
  | {
      ok: true;
      artifact_id: string;
      artifact_type: string;
      content: string;
      submission: RunSubmissionMeta;
    }
  | { ok: false; error: "run_not_found" | "artifact_not_found" };

export interface DashboardSignalRun {
  run: RunSummary;
  findings: Finding[];
}

export interface RunsStore {
  listSummaries(): Promise<RunSummary[]>;
  /**
   * Read-optimized query for dashboard operator lanes/highlights.
   * Returns newest runs with actionable severity plus parsed findings.
   */
  listDashboardSignalRuns(limit: number): Promise<DashboardSignalRun[]>;
  countSuppressedNoise(): Promise<number>;
  getApiDetail(id: string): Promise<GetRunDetailResponse | null>;
  getPageDetail(id: string): Promise<RunDetail | null>;
  getReport(id: string): Promise<unknown | null>;
  getComparePayload(
    id: string,
    against?: string | null
  ): Promise<{ ok: true; payload: CompareDriftPayload } | { ok: false; error: CompareDriftError }>;
  getReanalyzeSource(parentRunId: string): Promise<ReanalyzeSourceResult>;
  persistAnalyzedRun(input: PersistAnalyzedRunInput): Promise<PersistAnalyzedRunResult>;
}

export interface SourceView {
  id: string;
  display_name: string;
  target_identifier: string;
  source_type: string;
  expected_artifact_type: string;
  default_collector_type: string;
  default_collector_version: string | null;
  capabilities: string[];
  attributes: Record<string, unknown>;
  labels: Record<string, string>;
  default_collection_scope: CollectionScope | null;
  enabled: boolean;
  last_seen_at: string | null;
  health_status: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardCollectionSourceState {
  source: SourceView;
  hasRegistration: boolean;
}

export interface CollectionJobView {
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
  collection_scope: CollectionScope | null;
}

export interface AgentRegistrationView {
  id: string;
  source_id: string;
  display_name: string | null;
  created_at: string;
  last_capabilities_json?: string;
  last_heartbeat_at?: string | null;
  last_agent_version?: string | null;
  last_instance_id?: string | null;
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
  default_collection_scope?: CollectionScope | null;
  enabled?: boolean;
}

export interface CreateCollectionJobInput {
  request_reason?: string | null;
  priority?: number;
  idempotency_key?: string | null;
  collection_scope?: CollectionScope | null;
}

export type DeleteSourceResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "active_jobs" };

export interface SourcesStore {
  list(opts?: { enabled?: boolean }): Promise<SourceView[]>;
  /**
   * Read-optimized source + registration shape for dashboard collection cards/pulse.
   * Avoids N+1 registration lookups by returning one row per source with registration presence.
   */
  listDashboardCollectionSourceStates(
    opts?: { enabled?: boolean }
  ): Promise<DashboardCollectionSourceState[]>;
  getById(id: string): Promise<SourceView | null>;
  create(input: CreateSourceInput): Promise<SourceView>;
  update(id: string, patch: PatchSourceInput): Promise<SourceView | null>;
  delete(id: string): Promise<DeleteSourceResult>;
}

export interface JobsStore {
  listForSource(sourceId: string, opts?: { status?: string }): Promise<CollectionJobView[]>;
  getById(id: string): Promise<CollectionJobView | null>;
  queueForSource(
    sourceId: string,
    input: CreateCollectionJobInput
  ): Promise<{ row: CollectionJobView; inserted: boolean }>;
  cancel(id: string): Promise<CollectionJobView | null>;
  reapExpiredLeases(): Promise<number>;
  listNextForAgent(
    sourceId: string,
    registrationId: string,
    limit: number
  ): Promise<ListNextQueuedJobsResult>;
  /**
   * Agent poll read model boundary:
   * applies lease reaping and then returns next eligible queued jobs in one storage call.
   */
  listNextForAgentAfterLeaseReap(
    sourceId: string,
    registrationId: string,
    limit: number
  ): Promise<ListNextQueuedJobsResult>;
  claimForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    leaseTtlSeconds: number
  ): Promise<
    | { ok: true; row: CollectionJobView }
    | { ok: false; code: "not_found" | "not_queued" | "wrong_source" }
  >;
  startForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string
  ): Promise<
    | { ok: true; row: CollectionJobView }
    | { ok: false; code: "wrong_job" | "not_claimed" | "lease_expired" | "wrong_lease" }
  >;
  failForAgent(
    jobId: string,
    sourceId: string,
    registrationId: string,
    instanceId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<
    | { ok: true; row: CollectionJobView }
    | { ok: false; code: "wrong_job" | "bad_state" | "lease_expired" | "wrong_lease" }
  >;
  submitArtifactForAgent(input: {
    jobId: string;
    sourceId: string;
    registrationId: string;
    instanceId: string;
    artifactType: string;
    sourceType: string;
    filename: string;
    content: string;
    ingestion: ParsedIngestionMeta;
    analysis: AnalysisResult;
  }): Promise<
    | {
        ok: true;
        job: CollectionJobView;
        run_id: string;
        artifact_id: string;
        run_status: string;
      }
    | {
        ok: false;
        code:
          | "not_found"
          | "wrong_source"
          | "artifact_type_mismatch"
          | "job_already_submitted"
          | "invalid_state"
          | "lease_expired"
          | "instance_mismatch"
          | "conflict";
        run_id?: string;
        artifact_id?: string;
      }
  >;
}

export interface AgentsStore {
  getRegistrationBySourceId(sourceId: string): Promise<AgentRegistrationView | null>;
  resolveRequestContextByTokenHash(tokenHash: string): Promise<{
    registration: AgentRegistrationView;
    source: SourceView;
  } | null>;
  createRegistration(
    sourceId: string,
    displayName?: string | null
  ): Promise<AgentRegistrationCreated>;
  rotateRegistration(sourceId: string): Promise<AgentRegistrationCreated>;
  applyHeartbeat(input: {
    sourceId: string;
    registrationId: string;
    capabilities: string[];
    attributes: Record<string, unknown>;
    agentVersion: string;
    activeJobId: string | null;
    instanceId: string | null;
  }): Promise<
    | { ok: true; result: ApplyAgentHeartbeatResult }
    | {
        ok: false;
        code:
          | "source_not_found"
          | "registration_not_found"
          | "active_job_not_found"
          | "forbidden"
          | "invalid_active_job_state"
          | "invalid_state"
          | "instance_mismatch"
          | "lease_expired";
      }
  >;
  /**
   * Agent heartbeat command boundary:
   * reap expired leases and apply heartbeat in one storage call.
   */
  applyHeartbeatAfterLeaseReap(input: {
    sourceId: string;
    registrationId: string;
    capabilities: string[];
    attributes: Record<string, unknown>;
    agentVersion: string;
    activeJobId: string | null;
    instanceId: string | null;
  }): Promise<
    | { ok: true; result: ApplyAgentHeartbeatResult }
    | {
        ok: false;
        code:
          | "source_not_found"
          | "registration_not_found"
          | "active_job_not_found"
          | "forbidden"
          | "invalid_active_job_state"
          | "invalid_state"
          | "instance_mismatch"
          | "lease_expired";
      }
  >;
}

export interface StorageTx {
  runs: RunsStore;
  sources: SourcesStore;
  jobs: JobsStore;
  agents: AgentsStore;
}

export interface Storage extends StorageTx {
  withTransaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
}
