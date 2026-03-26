/**
 * Published HTTP API shapes (Phase 5f). Source of truth for route behavior is still
 * the route handlers; these types mirror successful JSON bodies for agents and tooling.
 *
 * See `docs/api-contract.md` and `docs/schemas/`.
 */

import type { AuditReport } from "@/lib/analyzer/schema";
import type { CompareDriftPayload } from "@/lib/compare/build-compare";
import type { CollectionScope } from "@/lib/collection-scope";
import type { RunSummary, RunDetail } from "@/types/api";

/** `POST /api/runs` — 200 body (also embeds parsed `report`). */
export interface PostRunsResponse {
  run_id: string;
  artifact_id: string;
  status: string;
  report: AuditReport | null;
}

/** `POST /api/runs/[id]/reanalyze` — 200 body (no full report; fetch GET report or run detail). */
export interface PostReanalyzeResponse {
  run_id: string;
  artifact_id: string;
  parent_run_id: string;
  status: string;
}

/** `GET /api/runs` — 200 body. */
export interface GetRunsListResponse {
  runs: RunSummary[];
}

/**
 * `GET /api/runs/[id]` — 200 body. Matches {@link RunDetail} with `links` always set for this route.
 */
export type GetRunDetailResponse = RunDetail & {
  links: { compare_ui: string; compare_api: string };
};

/** `GET /api/runs/[id]/report` — 200 body is the raw `AuditReport` JSON (not wrapped). */
export type GetRunReportResponse = AuditReport;

/** `GET /api/runs/[id]/compare` — 200 body (deterministic drift; no LLM). */
export type GetCompareResponse = CompareDriftPayload;

/** Standard error JSON for 4xx/5xx when the handler returns `{ error: string, code?: string }`. */
export interface ApiErrorBody {
  error: string;
  code?: string;
}

/** `Source` JSON returned by `GET/POST/PATCH /api/sources*`. */
export interface SourceResponse {
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

/** `CollectionJob` JSON returned by source/job routes. */
export interface CollectionJobResponse {
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

/** `GET /api/agent/jobs/next` successful body. */
export interface GetAgentNextJobsResponse {
  jobs: Array<{
    id: string;
    source_id: string;
    artifact_type: string;
    status: string;
    created_at: string;
    request_reason: string | null;
    collection_scope: CollectionScope | null;
  }>;
  gate: "source_disabled" | "heartbeat_required" | "capabilities_empty" | "capability_mismatch" | null;
}

/** Optional `POST /api/runs` ingestion fields (JSON body or multipart form). */
export type { ParsedIngestionMeta } from "@/lib/ingestion/meta";
