/**
 * Published HTTP API shapes (Phase 5f). Source of truth for route behavior is still
 * the route handlers; these types mirror successful JSON bodies for agents and tooling.
 *
 * See `docs/api-contract.md` and `docs/schemas/`.
 */

import type { AuditReport } from "@/lib/analyzer/schema";
import type { CompareDriftPayload } from "@/lib/compare/build-compare";
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

/** Standard error JSON for 4xx/5xx when the handler returns `{ error: string }`. */
export interface ApiErrorBody {
  error: string;
}

/** Optional `POST /api/runs` ingestion fields (JSON body or multipart form). */
export type { ParsedIngestionMeta } from "@/lib/ingestion/meta";
