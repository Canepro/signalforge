import { describe, expect, it } from "vitest";
import {
  backfillMissingCollectedAtInSqlite,
  inferCollectedAtForStoredRun,
  inferCollectedAtFromUploadedFile,
} from "@/lib/ingestion/collected-at";
import { getTestDb } from "@/lib/db/client";
import { insertArtifact, insertRun, getRun } from "@/lib/db/repository";
import { analyzeArtifact } from "@/lib/analyzer/index";

describe("inferCollectedAtForStoredRun", () => {
  it("prefers collector filename timestamps over unstable uploaded file metadata", () => {
    const collectedAt = inferCollectedAtFromUploadedFile(
      {
        lastModified: Date.UTC(2026, 2, 30, 22, 29, 46),
      },
      "server_audit_20260329_001155.log"
    );

    expect(collectedAt).toBe("2026-03-29T00:11:55.000Z");
  });

  it("prefers kubernetes bundle manifest collected_at when present", () => {
    const collectedAt = inferCollectedAtForStoredRun({
      id: "r1",
      artifact_type: "kubernetes-bundle",
      filename: "bundle.json",
      content: JSON.stringify({
        schema_version: "kubernetes-bundle.v1",
        cluster: { name: "oke-cluster" },
        scope: { level: "namespace", namespace: "monitoring" },
        collected_at: "2026-03-29T00:18:15Z",
        documents: [],
      }),
      created_at: "2026-03-29T00:20:00.000Z",
      source_label: "agent:test",
    });

    expect(collectedAt).toBe("2026-03-29T00:18:15.000Z");
  });

  it("falls back to collector filename timestamps", () => {
    const collectedAt = inferCollectedAtForStoredRun({
      id: "r2",
      artifact_type: "linux-audit-log",
      filename: "server_audit_20260329_001155.log",
      content: "raw-log",
      created_at: "2026-03-29T00:20:00.000Z",
      source_label: null,
    });

    expect(collectedAt).toBe("2026-03-29T00:11:55.000Z");
  });

  it("falls back to run created_at for agent-produced rows without better hints", () => {
    const collectedAt = inferCollectedAtForStoredRun({
      id: "r3",
      artifact_type: "container-diagnostics",
      filename: "container_snapshot.txt",
      content: "container output",
      created_at: "2026-03-29T00:17:47.000Z",
      source_label: "agent:test",
    });

    expect(collectedAt).toBe("2026-03-29T00:17:47.000Z");
  });

  it("leaves non-agent legacy direct uploads unset when no timestamp hint exists", () => {
    const collectedAt = inferCollectedAtForStoredRun({
      id: "r4",
      artifact_type: "linux-audit-log",
      filename: "manual-upload.log",
      content: "raw-log",
      created_at: "2026-03-29T00:20:00.000Z",
      source_label: null,
    });

    expect(collectedAt).toBeNull();
  });
});

describe("backfillMissingCollectedAtInSqlite", () => {
  it("repairs eligible historical runs in place and leaves direct uploads alone", async () => {
    const db = await getTestDb();
    const hostContent = "host log content";
    const directContent = "manual upload";
    const result = await analyzeArtifact("PRETTY_NAME=Ubuntu\n", { artifactType: "linux-audit-log" });

    const hostArtifact = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "agent",
      filename: "server_audit_20260329_001155.log",
      content: hostContent,
    });
    const directArtifact = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "manual-upload.log",
      content: directContent,
    });

    const hostRun = insertRun(db, hostArtifact.id, result, {
      filename: "server_audit_20260329_001155.log",
      source_type: "agent",
      source_label: "agent:test",
      collected_at: null,
    });
    const directRun = insertRun(db, directArtifact.id, result, {
      filename: "manual-upload.log",
      source_type: "api",
      source_label: null,
      collected_at: null,
    });

    const summary = backfillMissingCollectedAtInSqlite(db);

    expect(summary).toEqual({ scanned: 2, updated: 1, skipped: 1 });
    expect(getRun(db, hostRun.id)?.collected_at).toBe("2026-03-29T00:11:55.000Z");
    expect(getRun(db, directRun.id)?.collected_at).toBeNull();
  });
});
