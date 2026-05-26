import type { CollectionJobView } from "@/lib/storage/contract";
import type {
  AutomationDiagnosticRequestResult,
  GetAutomationDiagnosticRequestResponse,
  GetRunDetailResponse,
} from "@/types/api-contract";

function pollUrlForJob(jobId: string): string {
  return `/api/automation-agent/diagnostic-requests/${jobId}`;
}

function buildResult(run: GetRunDetailResponse): AutomationDiagnosticRequestResult {
  return {
    run_id: run.id,
    artifact_id: run.artifact_id,
    artifact_type: run.artifact_type,
    target_identifier: run.target_identifier,
    status: run.status,
    severity_counts: run.severity_counts,
    summary: run.report?.summary ?? [],
    top_actions_now: run.report?.top_actions_now ?? [],
    findings: run.report?.findings ?? [],
    environment_context: run.report?.environment_context ?? run.environment ?? null,
    is_incomplete: run.is_incomplete,
    incomplete_reason: run.incomplete_reason,
    analysis_error: run.analysis_error,
    links: {
      run: `/api/runs/${run.id}`,
      report: `/api/runs/${run.id}/report`,
      compare_api: run.links.compare_api,
    },
  };
}

export function buildAutomationDiagnosticRequestResponse(
  job: CollectionJobView,
  run: GetRunDetailResponse | null
): GetAutomationDiagnosticRequestResponse {
  return {
    request: {
      id: job.id,
      source_id: job.source_id,
      status: job.status,
      requested_by: job.requested_by,
      request_reason: job.request_reason,
      artifact_type: job.artifact_type,
      created_at: job.created_at,
      claimed_at: job.claimed_at,
      started_at: job.started_at,
      submitted_at: job.submitted_at,
      finished_at: job.finished_at,
      result_run_id: job.result_run_id,
      result_artifact_id: job.result_artifact_id,
      result_analysis_status: job.result_analysis_status,
      error_code: job.error_code,
      error_message: job.error_message,
      poll_url: pollUrlForJob(job.id),
    },
    result: run ? buildResult(run) : null,
  };
}

export function buildAutomationDiagnosticRequestAcceptedResponse(
  job: CollectionJobView
): {
  request_id: string;
  collection_job_id: string;
  source_id: string;
  status: string;
  poll_url: string;
} {
  return {
    request_id: job.id,
    collection_job_id: job.id,
    source_id: job.source_id,
    status: job.status,
    poll_url: pollUrlForJob(job.id),
  };
}
