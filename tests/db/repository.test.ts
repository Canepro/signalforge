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
  getArtifactById,
  findPreviousRunForSameArtifact,
  findPreviousRunForSameTarget,
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

    it("deduplicates by content hash (artifact row keeps first-upload metadata only)", () => {
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
      expect(second.filename).toBe("upload1.log");
      expect(second.source_type).toBe("api");
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
    it("stores Phase 5a ingestion metadata on runs", async () => {
      const raw = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "ingest.log",
        content: raw,
      });
      const result = await analyzeArtifact(raw, { artifactType: "linux-audit-log" });
      const run = insertRun(db, artifact.id, result, {
        filename: "ingest.log",
        source_type: "collector",
        target_identifier: "t-1",
        source_label: "lab",
        collector_type: "kit",
        collector_version: "3.0.0",
        collected_at: "2025-01-02T00:00:00.000Z",
      });
      const loaded = getRun(db, run.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.target_identifier).toBe("t-1");
      expect(loaded!.source_label).toBe("lab");
      expect(loaded!.collector_type).toBe("kit");
      expect(loaded!.collector_version).toBe("3.0.0");
      expect(loaded!.collected_at).toBe("2025-01-02T00:00:00.000Z");

      const listed = listRuns(db);
      expect(listed[0].target_identifier).toBe("t-1");
      expect(listed[0].collector_type).toBe("kit");
    });

    it("inserts a run from analysis result", async () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "sample.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result, {
        filename: "sample.log",
        source_type: "api",
      });

      expect(run.id).toBeTruthy();
      expect(run.artifact_id).toBe(artifact.id);
      expect(run.status).toBe("complete");
      expect(run.report_json).toBeTruthy();
      expect(run.environment_json).toBeTruthy();
      expect(run.filename).toBe("sample.log");
      expect(run.source_type).toBe("api");
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
      const run = insertRun(db, artifact.id, result, { filename: "test.log", source_type: "api" });

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
      const run = insertRun(db, artifact.id, result, { filename: "wsl.log", source_type: "api" });

      expect(run.status).toBe("complete");
      expect(run.report_json).toBeTruthy();
      expect(run.analysis_error).toBeTruthy();

      const report = JSON.parse(run.report_json!);
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.top_actions_now).toHaveLength(3);
    });

    it("each run keeps its own filename and source_type when artifact is deduped", async () => {
      const content = "same-bytes-for-dedupe-test";
      const artifact1 = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "first.log",
        content,
      });
      const artifact2 = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "upload",
        filename: "second.log",
        content,
      });
      expect(artifact1.id).toBe(artifact2.id);

      const result = await analyzeArtifact(content);
      insertRun(db, artifact1.id, result, { filename: "first.log", source_type: "api" });
      insertRun(db, artifact2.id, result, { filename: "second.log", source_type: "upload" });

      const runs = listRuns(db);
      expect(runs).toHaveLength(2);
      const byName = Object.fromEntries(runs.map((r) => [r.filename, r]));
      expect(byName["first.log"].source_type).toBe("api");
      expect(byName["second.log"].source_type).toBe("upload");

      const secondRun = runs.find((r) => r.filename === "second.log")!;
      const detail = getRunWithArtifact(db, secondRun.id);
      expect(detail!.filename).toBe("second.log");
      expect(detail!.source_type).toBe("upload");
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
      insertRun(db, artifact.id, result, { filename: "wsl.log", source_type: "api" });

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
      const run = insertRun(db, artifact.id, result, { filename: "sample.log", source_type: "api" });

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
      const run = insertRun(db, artifact.id, result, { filename: "wsl-nov.log", source_type: "upload" });

      const detail = getRunWithArtifact(db, run.id);
      expect(detail).not.toBeNull();
      expect(detail!.filename).toBe("wsl-nov.log");
      expect(detail!.artifact_type).toBe("linux-audit-log");
      expect(detail!.source_type).toBe("upload");
    });
  });

  describe("getArtifactById", () => {
    it("returns stored artifact row", () => {
      const content = "lookup-artifact-body";
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "f.log",
        content,
      });
      const row = getArtifactById(db, artifact.id);
      expect(row).not.toBeNull();
      expect(row!.content).toBe(content);
      expect(row!.artifact_type).toBe("linux-audit-log");
    });

    it("returns null for unknown id", () => {
      expect(getArtifactById(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });

  describe("findPreviousRunForSameArtifact", () => {
    it("returns the latest older run for the same artifact", async () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "sample.log",
        content,
      });
      const result = await analyzeArtifact(content);
      const older = insertRun(db, artifact.id, result, { filename: "v1.log", source_type: "api" });
      db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
        "2020-01-01T00:00:00.000Z",
        older.id,
      ]);
      const newer = insertRun(db, artifact.id, result, { filename: "v2.log", source_type: "api" });
      db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
        "2020-02-01T00:00:00.000Z",
        newer.id,
      ]);

      const prev = findPreviousRunForSameArtifact(db, newer.id);
      expect(prev).not.toBeNull();
      expect(prev!.id).toBe(older.id);

      expect(findPreviousRunForSameArtifact(db, older.id)).toBeNull();
    });

    it("returns null when no older run shares the artifact", async () => {
      const content = "other-body";
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "only.log",
        content,
      });
      const result = await analyzeArtifact(content);
      const run = insertRun(db, artifact.id, result, { filename: "only.log", source_type: "api" });
      expect(findPreviousRunForSameArtifact(db, run.id)).toBeNull();
    });
  });

  describe("findPreviousRunForSameTarget", () => {
    it("returns the latest older run for the same hostname even when artifact content changes", async () => {
      const olderContent = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");
      const newerContent = readFileSync(join(FIXTURES, "wsl-mar2026-full.log"), "utf-8");

      const olderArtifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "older.log",
        content: olderContent,
      });
      const newerArtifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "newer.log",
        content: newerContent,
      });

      const olderResult = await analyzeArtifact(olderContent);
      const newerResult = await analyzeArtifact(newerContent);
      const older = insertRun(db, olderArtifact.id, olderResult, {
        filename: "older.log",
        source_type: "api",
      });
      db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
        "2020-01-01T00:00:00.000Z",
        older.id,
      ]);
      const newer = insertRun(db, newerArtifact.id, newerResult, {
        filename: "newer.log",
        source_type: "api",
      });
      db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
        "2020-02-01T00:00:00.000Z",
        newer.id,
      ]);

      const prev = findPreviousRunForSameTarget(db, newer.id);
      expect(prev).not.toBeNull();
      expect(prev!.id).toBe(older.id);
      expect(prev!.artifact_id).not.toBe(newer.artifact_id);
    });

    it("matches by target_identifier when set, ignoring hostname differences", async () => {
      const contentA = "=== server-audit-kit ===\nhostname: host-a\n=== uname -a ===\nLinux a 5.0 x86_64\n";
      const contentB = "=== server-audit-kit ===\nhostname: host-b\n=== uname -a ===\nLinux b 5.0 x86_64\n";

      const artA = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "a.log",
        content: contentA,
      });
      const artB = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "b.log",
        content: contentB,
      });

      const resA = await analyzeArtifact(contentA);
      const resB = await analyzeArtifact(contentB);
      const older = insertRun(db, artA.id, resA, {
        filename: "a.log",
        source_type: "api",
        target_identifier: "fleet:shared",
      });
      const newer = insertRun(db, artB.id, resB, {
        filename: "b.log",
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

      const prev = findPreviousRunForSameTarget(db, newer.id);
      expect(prev).not.toBeNull();
      expect(prev!.id).toBe(older.id);
    });

    it("does not match same hostname when target_identifier differs", async () => {
      const content = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "shared.log",
        content,
      });
      const result = await analyzeArtifact(content);
      const older = insertRun(db, artifact.id, result, {
        filename: "v1.log",
        source_type: "api",
      });
      const newer = insertRun(db, artifact.id, result, {
        filename: "v2.log",
        source_type: "api",
      });
      db.run("UPDATE runs SET created_at = ?, target_identifier = ? WHERE id = ?", [
        "2020-01-01T00:00:00.000Z",
        "tid-b",
        older.id,
      ]);
      db.run("UPDATE runs SET created_at = ?, target_identifier = ? WHERE id = ?", [
        "2020-02-01T00:00:00.000Z",
        "tid-a",
        newer.id,
      ]);
      expect(findPreviousRunForSameTarget(db, newer.id)).toBeNull();
    });

    it("falls back to same-artifact lookup when hostname is unavailable", async () => {
      const content = "minimal";
      const artifact = insertArtifact(db, {
        artifact_type: "linux-audit-log",
        source_type: "api",
        filename: "unknown.log",
        content,
      });

      const result = await analyzeArtifact(content);
      const older = insertRun(db, artifact.id, result, {
        filename: "older.log",
        source_type: "api",
      });
      db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
        "2020-01-01T00:00:00.000Z",
        older.id,
      ]);
      const newer = insertRun(db, artifact.id, result, {
        filename: "newer.log",
        source_type: "api",
      });
      db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
        "2020-02-01T00:00:00.000Z",
        newer.id,
      ]);

      const prev = findPreviousRunForSameTarget(db, newer.id);
      expect(prev).not.toBeNull();
      expect(prev!.id).toBe(older.id);
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
