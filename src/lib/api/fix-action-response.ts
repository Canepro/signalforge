import type { FixActionRunView } from "@/lib/storage/contract";
import type { FixActionRunResponse, GetFixActionRunResponse } from "@/types/api-contract";

export function fixActionPollUrl(id: string): string {
  return `/api/automation-agent/fix-action-runs/${id}`;
}

export function buildFixActionRunResponse(action: FixActionRunView): GetFixActionRunResponse {
  return {
    action_run: toFixActionRunResponse(action),
  };
}

export function toFixActionRunResponse(action: FixActionRunView): FixActionRunResponse {
  return {
    id: action.id,
    source_id: action.source_id,
    automation_signal_id: action.automation_signal_id,
    diagnostic_request_id: action.diagnostic_request_id,
    pre_fix_run_id: action.pre_fix_run_id,
    post_fix_run_id: action.post_fix_run_id,
    finding_id: action.finding_id,
    policy_id: action.policy_id,
    action_kind: action.action_kind,
    action_payload: action.action_payload,
    status: action.status,
    requested_by: action.requested_by,
    dry_run_summary: action.dry_run_summary,
    apply_summary: action.apply_summary,
    error_code: action.error_code,
    error_message: action.error_message,
    poll_url: fixActionPollUrl(action.id),
  };
}
