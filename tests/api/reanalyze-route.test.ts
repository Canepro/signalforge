import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import * as dbClient from "@/lib/db/client";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";
import { insertArtifact, insertRun, getRun, submissionMetaFromRun } from "@/lib/db/repository";
import type { AnalysisResult } from "@/lib/analyzer/schema";
import * as analyzer from "@/lib/analyzer/index";
import { POST as POST_REANALYZE } from "@/app/api/runs/[id]/reanalyze/route";

function minimalAnalysisResult(): AnalysisResult {
  const env = {
    hostname: "h",
    os: "Linux",
    kernel: "k",
    is_wsl: false,
    is_container: false,
    is_virtual_machine: false,
    ran_as_root: false,
    uptime: "up",
  };
  return {
    report: {
      summary: ["one", "two", "three"],
      findings: [],
      environment_context: env,
      noise_or_expected: [],
      top_actions_now: ["a", "b", "c"],
    },
    environment: env,
    noise: [],
    pre_findings: [],
    is_incomplete: false,
    meta: {
      model_used: "mock",
      tokens_used: 0,
      duration_ms: 0,
      llm_succeeded: true,
    },
  };
}

describe("API POST /api/runs/[id]/reanalyze", () => {
  let db: Database;

  beforeEach(async () => {
    db = await getTestDb();
    dbClient.setDbOverride(db);
    vi.spyOn(dbClient, "saveDb");
    vi.spyOn(analyzer, "analyzeArtifact").mockResolvedValue(minimalAnalysisResult());
  });

  afterEach(() => {
    dbClient.setDbOverride(null);
    db.close();
    vi.restoreAllMocks();
  });

  it("returns generic 500 when analyzeArtifact throws", async () => {
    vi.spyOn(analyzer, "analyzeArtifact").mockRejectedValueOnce(new Error("SECRET_LLM"));
    const artifact = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "b.log",
      content: "bytes",
    });
    const first = insertRun(db, artifact.id, minimalAnalysisResult(), {
      filename: "b.log",
      source_type: "api",
    });
    const res = await POST_REANALYZE(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ id: first.id }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });

  it("returns 404 when run is missing", async () => {
    const res = await POST_REANALYZE(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("reuses artifact, inserts child run with parent_run_id, calls saveDb", async () => {
    const artifact = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "base.log",
      content: "artifact-bytes",
    });
    const first = insertRun(db, artifact.id, minimalAnalysisResult(), {
      filename: "base.log",
      source_type: "api",
      target_identifier: "reanalyze-parent-target",
      collector_type: "test-collector",
      collector_version: "0.0.1",
      collected_at: "2024-01-01T00:00:00.000Z",
    });

    const res = await POST_REANALYZE(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ id: first.id }),
    });
    expect(res.status).toBe(200);
    expect(dbClient.saveDb).toHaveBeenCalled();
    expect(analyzer.analyzeArtifact).toHaveBeenCalledWith("artifact-bytes", {
      artifactType: "linux-audit-log",
    });

    const body = (await res.json()) as {
      run_id: string;
      artifact_id: string;
      parent_run_id: string;
    };
    expect(body.run_id).toBeTruthy();
    expect(body.artifact_id).toBe(artifact.id);
    expect(body.parent_run_id).toBe(first.id);

    const child = getRun(db, body.run_id);
    expect(child).not.toBeNull();
    expect(child!.parent_run_id).toBe(first.id);
    expect(child!.artifact_id).toBe(artifact.id);
    expect(submissionMetaFromRun(child!)).toEqual(submissionMetaFromRun(first));
  });
});
