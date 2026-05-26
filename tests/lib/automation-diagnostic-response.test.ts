import { describe, it, expect } from "vitest";
import { buildAutomationDiagnosticRequestResponse } from "@/lib/api/automation-diagnostic-response";
import type { CollectionJobView } from "@/lib/storage/contract";
import type { GetRunDetailResponse } from "@/types/api-contract";

function makeJob(overrides: Partial<CollectionJobView> = {}): CollectionJobView {
  return {
    id: "job-1",
    source_id: "source-1",
    artifact_type: "linux-audit-log",
    status: "submitted",
    requested_by: "automation_agent:auto-1",
    request_reason: "collect",
    priority: 0,
    idempotency_key: null,
    lease_owner_id: null,
    lease_owner_instance_id: null,
    lease_expires_at: null,
    last_heartbeat_at: null,
    result_artifact_id: "artifact-1",
    result_run_id: "run-1",
    error_code: null,
    error_message: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    queued_at: "2025-01-01T00:00:00.000Z",
    claimed_at: "2025-01-01T00:01:00.000Z",
    started_at: "2025-01-01T00:02:00.000Z",
    submitted_at: "2025-01-01T00:03:00.000Z",
    finished_at: "2025-01-01T00:03:00.000Z",
    result_analysis_status: "complete",
    collection_scope: { kind: "linux_host" },
    trigger_signal_id: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<GetRunDetailResponse> = {}): GetRunDetailResponse {
  return {
    id: "run-1",
    artifact_id: "artifact-1",
    parent_run_id: null,
    links: {
      compare_ui: "/runs/run-1/compare",
      compare_api: "/api/runs/run-1/compare",
    },
    filename: "audit.log",
    artifact_type: "linux-audit-log",
    source_type: "agent",
    target_identifier: "tid-1",
    source_label: "agent:1",
    collector_type: "signalforge-collectors",
    collector_version: "1.0.0",
    collected_at: null,
    created_at: "2025-01-01T00:03:00.000Z",
    status: "complete",
    is_incomplete: false,
    incomplete_reason: null,
    analysis_error: null,
    model_used: "test",
    tokens_used: 1,
    duration_ms: 1,
    severity_counts: { critical: 0, high: 1, medium: 0, low: 0 },
    report: {
      summary: ["one"],
      findings: [
        {
          id: "F1",
          title: "Issue",
          severity: "high",
          category: "network",
          section_source: "ss",
          evidence: "x",
          why_it_matters: "y",
          recommended_action: "z",
        },
      ],
      environment_context: {
        hostname: "host-1",
        os: "linux",
        kernel: "k",
        is_wsl: false,
        is_container: false,
        is_virtual_machine: false,
        ran_as_root: true,
        uptime: "1h",
      },
      noise_or_expected: [],
      top_actions_now: ["a", "b", "c"],
    },
    environment: {
      hostname: "host-1",
      os: "linux",
      kernel: "k",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: true,
      uptime: "1h",
    },
    noise: [],
    pre_findings: [],
    ...overrides,
  };
}

describe("buildAutomationDiagnosticRequestResponse", () => {
  it("builds a structured result envelope from job and run detail", () => {
    const response = buildAutomationDiagnosticRequestResponse(makeJob(), makeRun());
    expect(response.request.poll_url).toBe("/api/automation-agent/diagnostic-requests/job-1");
    expect(response.result?.summary).toEqual(["one"]);
    expect(response.result?.top_actions_now).toEqual(["a", "b", "c"]);
    expect(response.result?.findings).toHaveLength(1);
    expect(response.result?.links.run).toBe("/api/runs/run-1");
    expect(response.result?.links.report).toBe("/api/runs/run-1/report");
    expect(response.result?.links.compare_api).toBe("/api/runs/run-1/compare");
  });

  it("returns a null result for pending jobs", () => {
    const response = buildAutomationDiagnosticRequestResponse(
      makeJob({ status: "running", result_run_id: null, result_artifact_id: null }),
      null
    );
    expect(response.request.status).toBe("running");
    expect(response.result).toBeNull();
  });
});
