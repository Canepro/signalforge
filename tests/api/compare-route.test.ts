import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalysisResult, AuditReport, Finding, Severity } from "@/lib/analyzer/schema";
import { GET as GET_COMPARE } from "@/app/api/runs/[id]/compare/route";
import * as dbClient from "@/lib/db/client";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";
import { insertArtifact, insertRun } from "@/lib/db/repository";

function baseEnv(hostname: string) {
  return {
    hostname,
    os: "Linux",
    kernel: "k",
    is_wsl: false,
    is_container: false,
    is_virtual_machine: false,
    ran_as_root: true,
    uptime: "1d",
  };
}

function mkFinding(id: string, title: string, severity: Severity): Finding {
  return {
    id,
    title,
    severity,
    category: "test",
    section_source: "sec",
    evidence: "ev",
    why_it_matters: "w",
    recommended_action: "r",
  };
}

function mkReport(hostname: string, findings: Finding[]): AuditReport {
  return {
    summary: ["summary line"],
    findings,
    environment_context: baseEnv(hostname),
    noise_or_expected: [],
    top_actions_now: ["a", "b", "c"],
  };
}

function mkResult(report: AuditReport | null): AnalysisResult {
  if (!report) {
    return {
      report: null,
      environment: baseEnv("none"),
      noise: [],
      pre_findings: [],
      is_incomplete: false,
      meta: { model_used: "test", tokens_used: 0, duration_ms: 0, llm_succeeded: false },
    };
  }
  return {
    report,
    environment: report.environment_context,
    noise: [],
    pre_findings: [],
    is_incomplete: false,
    meta: { model_used: "test", tokens_used: 0, duration_ms: 0, llm_succeeded: false },
  };
}

describe("API GET /api/runs/[id]/compare", () => {
  let db: Database;

  beforeEach(async () => {
    db = await getTestDb();
    dbClient.setDbOverride(db);
    vi.spyOn(dbClient, "saveDb");
  });

  afterEach(() => {
    dbClient.setDbOverride(null);
    db.close();
    vi.restoreAllMocks();
  });

  it("returns 404 when current run is missing", async () => {
    const res = await GET_COMPARE(
      new NextRequest("http://localhost/api/runs/nope/compare"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when against equals current id", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "x",
    });
    const run = insertRun(db, art.id, mkResult(mkReport("h", [{ ...mkFinding("1", "Only", "low") }])), {
      filename: "a.log",
      source_type: "api",
    });

    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${run.id}/compare?against=${run.id}`),
      { params: Promise.resolve({ id: run.id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/against/i);
  });

  it("returns 404 when explicit against run is missing", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "x",
    });
    const run = insertRun(db, art.id, mkResult(mkReport("h", [{ ...mkFinding("1", "Only", "low") }])), {
      filename: "a.log",
      source_type: "api",
    });

    const res = await GET_COMPARE(
      new NextRequest(
        `http://localhost/api/runs/${run.id}/compare?against=00000000-0000-4000-8000-000000000099`
      ),
      { params: Promise.resolve({ id: run.id }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns baseline_missing true when no prior run for same target", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "solo.log",
      content: "solo",
    });
    const run = insertRun(
      db,
      art.id,
      mkResult(mkReport("solo-host", [{ ...mkFinding("1", "Solo finding", "medium") }])),
      { filename: "solo.log", source_type: "api" }
    );

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${run.id}/compare`), {
      params: Promise.resolve({ id: run.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline_missing).toBe(true);
    expect(body.baseline).toBeNull();
    expect(body.baseline_selection).toBe("none");
    expect(body.target_mismatch).toBe(false);
    expect(body.against_requested).toBeNull();
    expect(body.current.id).toBe(run.id);
    expect(body.current.run_id).toBe(run.id);
    expect(body.current.environment_hostname).toBe("solo-host");
    expect(body.drift.summary).toEqual({
      new: 0,
      resolved: 0,
      severity_up: 0,
      severity_down: 0,
      unchanged: 0,
    });
    expect(body.drift.rows).toEqual([]);
  });

  it("uses implicit same-target baseline and reports drift severity", async () => {
    const content = "shared-content";
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content,
    });
    const f1 = mkFinding("f1", "Stable title", "low");
    const older = insertRun(db, art.id, mkResult(mkReport("host-x", [f1])), {
      filename: "older.log",
      source_type: "api",
    });
    const f1b = { ...f1, severity: "high" as Severity };
    const newer = insertRun(db, art.id, mkResult(mkReport("host-x", [f1b])), {
      filename: "newer.log",
      source_type: "api",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      older.id,
    ]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-02-01T00:00:00.000Z",
      newer.id,
    ]);

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline_missing).toBe(false);
    expect(body.baseline_selection).toBe("implicit_same_target");
    expect(body.baseline.id).toBe(older.id);
    expect(body.baseline.run_id).toBe(older.id);
    expect(body.current.run_id).toBe(newer.id);
    expect(body.target_mismatch).toBe(false);
    expect(body.drift.summary.severity_up).toBe(1);
    expect(body.drift.summary.unchanged).toBe(0);
    expect(body.drift.rows).toHaveLength(1);
    expect(body.drift.rows[0].status).toBe("severity_up");
  });

  it("respects explicit against over implicit baseline", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "trip",
    });
    const f = mkFinding("f1", "Thing", "low");
    const oldest = insertRun(db, art.id, mkResult(mkReport("h", [f])), {
      filename: "oldest.log",
      source_type: "api",
    });
    const middle = insertRun(db, art.id, mkResult(mkReport("h", [{ ...f, severity: "medium" }])), {
      filename: "middle.log",
      source_type: "api",
    });
    const newest = insertRun(db, art.id, mkResult(mkReport("h", [{ ...f, severity: "high" }])), {
      filename: "newest.log",
      source_type: "api",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2020-01-01T00:00:00.000Z", oldest.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2020-02-01T00:00:00.000Z", middle.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2020-03-01T00:00:00.000Z", newest.id]);

    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${newest.id}/compare?against=${oldest.id}`),
      { params: Promise.resolve({ id: newest.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline_selection).toBe("explicit");
    expect(body.baseline.id).toBe(oldest.id);
    expect(body.baseline.run_id).toBe(oldest.id);
    expect(body.against_requested).toBe(oldest.id);
    expect(body.drift.summary.severity_up).toBe(1);
  });

  it("matches implicit baseline by target_identifier across hostnames", async () => {
    const a1 = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a1.log",
      content: "c1",
    });
    const a2 = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a2.log",
      content: "c2",
    });
    const f = mkFinding("f1", "X", "low");
    const older = insertRun(db, a1.id, mkResult(mkReport("host-a", [f])), {
      filename: "a1.log",
      source_type: "api",
      target_identifier: "fleet:shared",
    });
    const newer = insertRun(db, a2.id, mkResult(mkReport("host-b", [f])), {
      filename: "a2.log",
      source_type: "api",
      target_identifier: "fleet:shared",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      older.id,
    ]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-02-01T00:00:00.000Z",
      newer.id,
    ]);

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    const body = await res.json();
    expect(body.baseline.id).toBe(older.id);
    expect(body.baseline.run_id).toBe(older.id);
    expect(body.target_mismatch).toBe(false);
    expect(body.current.environment_hostname).not.toBe(body.baseline.environment_hostname);
  });

  it("sets target_mismatch when explicit baseline has different target identity (same hostname)", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "same",
    });
    const f = mkFinding("f1", "X", "low");
    const older = insertRun(db, art.id, mkResult(mkReport("samehost", [f])), {
      filename: "v1.log",
      source_type: "api",
      target_identifier: "tid-b",
    });
    const newer = insertRun(db, art.id, mkResult(mkReport("samehost", [f])), {
      filename: "v2.log",
      source_type: "api",
      target_identifier: "tid-a",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      older.id,
    ]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-02-01T00:00:00.000Z",
      newer.id,
    ]);

    // Implicit baseline would be null (tid-a does not match tid-b); explicit `against` selects the row.
    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${newer.id}/compare?against=${older.id}`),
      { params: Promise.resolve({ id: newer.id }) }
    );
    const body = await res.json();
    expect(body.baseline.id).toBe(older.id);
    expect(body.baseline.run_id).toBe(older.id);
    expect(body.baseline_selection).toBe("explicit");
    expect(body.target_mismatch).toBe(true);
  });
});
