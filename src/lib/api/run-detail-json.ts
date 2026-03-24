import { deriveSeverityCounts } from "@/lib/db/repository";
import type { RunRow } from "@/lib/db/repository";
import type { GetRunDetailResponse } from "@/types/api-contract";

/**
 * JSON body for `GET /api/runs/[id]` (single place for field list / agent contract).
 */
export function toRunDetailJson(
  row: RunRow & { artifact_type: string }
): GetRunDetailResponse {
  return {
    id: row.id,
    artifact_id: row.artifact_id,
    parent_run_id: row.parent_run_id,
    links: {
      compare_ui: `/runs/${row.id}/compare`,
      compare_api: `/api/runs/${row.id}/compare`,
    },
    filename: row.filename,
    artifact_type: row.artifact_type,
    source_type: row.source_type,
    target_identifier: row.target_identifier ?? null,
    source_label: row.source_label ?? null,
    collector_type: row.collector_type ?? null,
    collector_version: row.collector_version ?? null,
    collected_at: row.collected_at ?? null,
    created_at: row.created_at,
    status: row.status,
    is_incomplete: Boolean(row.is_incomplete),
    incomplete_reason: row.incomplete_reason,
    analysis_error: row.analysis_error,
    model_used: row.model_used,
    tokens_used: row.tokens_used,
    duration_ms: row.duration_ms,
    severity_counts: deriveSeverityCounts(row.report_json),
    report: row.report_json ? JSON.parse(row.report_json) : null,
    environment: row.environment_json ? JSON.parse(row.environment_json) : null,
    noise: row.noise_json ? JSON.parse(row.noise_json) : null,
    pre_findings: row.pre_findings_json ? JSON.parse(row.pre_findings_json) : null,
  };
}
