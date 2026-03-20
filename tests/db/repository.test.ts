import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Database } from "sql.js";
import { getTestDb } from "@/lib/db/client";
import {
  insertArtifact,
  insertRun,
  listRuns,
  getRun,
  getRunWithArtifact,
  contentHash,
  findArtifactByHash,
  deriveSeverityCounts,
} from "@/lib/db/repository";
import { analyzeArtifact } from "@/lib/analyzer/index";

const FIXTURES = join(__dirname, "../fixtures");

describe("repository", () => {
  let db: Database;

  beforeEach(async () => {
    db = await getTestDb();
  });

  describe("artifacts", () => {
    it("inserts and retrieves an artifact", () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "sample.log",
        content,
      });

      expect(artifact.id).toBeTruthy();
      expect(artifact.filename).toBe("sample.log");
      expect(artifact.artifact_type).toBe("linux-audit-log");
      expect(artifact.content_hash).toBe(contentHash(content));
    });

    it("deduplicates by content hash", () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");

      const first = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "upload1.log",
        content,
      });

      const second = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "upload",
        filename: "upload2.log",
        content,
      });

      expect(first.id).toBe(second.id);
      expect(first.content_hash).toBe(second.content_hash);
    });

    it("stores different content as separate artifacts", () => {
      const a = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "a.log",
        content: "content-a",
      });

      const b = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "b.log",
        content: "content-b",
      });

      expect(a.id).not.toBe(b.id);
    });

    it("finds artifact by hash", () => {
      const content = "unique-content-for-lookup";
      insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "lookup.log",
        content,
      });

      const found = findArtifactByHash(db, contentHash(content));
      expect(found).not.toBeNull();
      expect(found!.filename).toBe("lookup.log");
    });
  });

  describe("runs", () => {
    it("inserts a run from analysis result", async () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "sample.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result);

      expect(run.id).toBeTruthy();
      expect(run.artifact_id).toBe(artifact.id);
      expect(run.status).toBe("complete");
      expect(run.report_json).toBeTruthy();
      expect(run.environment_json).toBeTruthy();
    });

    it("stores parent_run_id as null when not provided", async () => {
      const content = "minimal";
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "test.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result);

      expect(run.parent_run_id).toBeNull();
    });

    it("fallback report is stored when LLM is unavailable", async () => {
      const content = readFileSync(join(FIXTURES, "wsl-mar2026-full.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "wsl.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result);

      expect(run.status).toBe("complete");
      expect(run.report_json).toBeTruthy();
      expect(run.analysis_error).toBeTruthy();

      const report = JSON.parse(run.report_json!);
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.top_actions_now).toHaveLength(3);
    });
  });

  describe("listRuns", () => {
    it("returns runs with severity counts", async () => {
      const content = readFileSync(join(FIXTURES, "wsl-mar2026-full.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "wsl.log",
        content,
      });

      const result = await analyzeArtifact(content);
      insertRun(db, artifact.id, result);

      const runs = listRuns(db);
      expect(runs.length).toBe(1);
      expect(runs[0].filename).toBe("wsl.log");
      expect(runs[0].status).toBe("complete");
      expect(typeof runs[0].severity_counts.high).toBe("number");
    });

    it("returns empty array when no runs exist", () => {
      const runs = listRuns(db);
      expect(runs).toEqual([]);
    });
  });

  describe("getRun and getRunWithArtifact", () => {
    it("retrieves run by id", async () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "sample.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result);

      const fetched = getRun(db, run.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(run.id);
    });

    it("returns null for nonexistent id", () => {
      expect(getRun(db, "nonexistent")).toBeNull();
    });

    it("getRunWithArtifact joins artifact metadata", async () => {
      const content = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "upload",
        filename: "wsl-nov.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result);

      const detail = getRunWithArtifact(db, run.id);
      expect(detail).not.toBeNull();
      expect(detail!.filename).toBe("wsl-nov.log");
      expect(detail!.artifact_type).toBe("linux-audit-log");
      expect(detail!.source_type).toBe("upload");
    });
  });

  describe("deriveSeverityCounts", () => {
    it("counts severities from report JSON", () => {
      const report = {
        findings: [
          { severity: "high" },
          { severity: "high" },
          { severity: "medium" },
          { severity: "low" },
        ],
      };
      const counts = deriveSeverityCounts(JSON.stringify(report));
      expect(counts).toEqual({ critical: 0, high: 2, medium: 1, low: 1 });
    });

    it("returns empty object for null", () => {
      expect(deriveSeverityCounts(null)).toEqual({});
    });

    it("returns empty object for invalid JSON", () => {
      expect(deriveSeverityCounts("not json")).toEqual({});
    });
  });
});
