import { describe, it, expect } from "vitest";
import { toRunDetailJson } from "@/lib/api/run-detail-json";
import type { RunRow } from "@/lib/db/repository";

describe("toRunDetailJson", () => {
  it("matches GET /api/runs/[id] contract shape", () => {
    const row = {
      id: "rid",
      artifact_id: "aid",
      parent_run_id: null,
      created_at: "2025-01-01T00:00:00.000Z",
      status: "complete",
      report_json: JSON.stringify({
        summary: ["s"],
        findings: [],
        environment_context: {
          hostname: "h",
          os: "o",
          kernel: "k",
          is_wsl: false,
          is_container: false,
          is_virtual_machine: false,
          ran_as_root: true,
          uptime: "1",
        },
        noise_or_expected: [],
        top_actions_now: ["a", "b", "c"],
      }),
      environment_json: JSON.stringify({
        hostname: "h",
        os: "o",
        kernel: "k",
        is_wsl: false,
        is_container: false,
        is_virtual_machine: false,
        ran_as_root: true,
        uptime: "1",
      }),
      noise_json: "[]",
      pre_findings_json: "[]",
      is_incomplete: 0,
      incomplete_reason: null,
      analysis_error: null,
      model_used: "test",
      tokens_used: 0,
      duration_ms: 1,
      filename: "f.log",
      source_type: "api",
      target_identifier: null,
      source_label: null,
      collector_type: null,
      collector_version: null,
      collected_at: null,
      artifact_type: "linux-audit-log",
    } as RunRow & { artifact_type: string };

    const j = toRunDetailJson(row);
    expect(j.id).toBe("rid");
    expect(j.links).toEqual({
      compare_ui: "/runs/rid/compare",
      compare_api: "/api/runs/rid/compare",
    });
    expect(j.report).not.toBeNull();
    expect(j.severity_counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});
