import { deriveSeverityCounts } from "@/lib/db/repository";
import type { RunRow } from "@/lib/db/repository";
import { buildRunDetailSummaryModules } from "@/lib/run-detail-summary";
import type { RunDetail } from "@/types/api";
import type { GetRunDetailResponse } from "@/types/api-contract";

function formatRunTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function buildRunDetail(
  row: RunRow & { artifact_type: string },
  parent_run: { id: string; filename: string } | null = null,
  artifactContent?: string | null
): RunDetail {
  const detail: RunDetail = {
    id: row.id,
    artifact_id: row.artifact_id,
    parent_run_id: row.parent_run_id,
    parent_run,
    filename: row.filename,
    artifact_type: row.artifact_type,
    source_type: row.source_type,
    target_identifier: row.target_identifier ?? null,
    source_label: row.source_label ?? null,
    collector_type: row.collector_type ?? null,
    collector_version: row.collector_version ?? null,
    collected_at: row.collected_at ?? null,
    collected_at_label: row.collected_at ? formatRunTimestamp(row.collected_at) : null,
    created_at: row.created_at,
    created_at_label: formatRunTimestamp(row.created_at),
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
  detail.summary_modules = buildRunDetailSummaryModules(detail, artifactContent ?? null);
  return detail;
}

/**
 * JSON body for `GET /api/runs/[id]` (single place for field list / agent contract).
 */
export function toRunDetailJson(
  row: RunRow & { artifact_type: string }
): GetRunDetailResponse {
  const detail = buildRunDetail(row);
  return {
    id: detail.id,
    artifact_id: detail.artifact_id,
    parent_run_id: detail.parent_run_id,
    links: {
      compare_ui: `/runs/${row.id}/compare`,
      compare_api: `/api/runs/${row.id}/compare`,
    },
    filename: detail.filename,
    artifact_type: detail.artifact_type,
    source_type: detail.source_type,
    target_identifier: detail.target_identifier,
    source_label: detail.source_label,
    collector_type: detail.collector_type,
    collector_version: detail.collector_version,
    collected_at: detail.collected_at,
    created_at: detail.created_at,
    status: detail.status,
    is_incomplete: detail.is_incomplete,
    incomplete_reason: detail.incomplete_reason,
    analysis_error: detail.analysis_error,
    model_used: detail.model_used,
    tokens_used: detail.tokens_used,
    duration_ms: detail.duration_ms,
    severity_counts: detail.severity_counts,
    report: detail.report,
    environment: detail.environment,
    noise: detail.noise,
    pre_findings: detail.pre_findings,
  };
}
