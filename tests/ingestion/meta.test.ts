import { describe, it, expect } from "vitest";
import {
  parseIngestionMeta,
  ingestionRecordFromFormData,
} from "@/lib/ingestion/meta";
import { inferCollectedAtFromUploadedFile } from "@/lib/ingestion/collected-at";

describe("parseIngestionMeta", () => {
  it("accepts empty input", () => {
    const r = parseIngestionMeta({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.target_identifier).toBeNull();
      expect(r.meta.collected_at).toBeNull();
    }
  });

  it("parses valid strings and normalizes collected_at to ISO", () => {
    const r = parseIngestionMeta({
      target_identifier: "  fleet:prod:web-01  ",
      source_label: "cron weekly",
      collector_type: "signalforge-collectors",
      collector_version: "2.1.0",
      collected_at: "2025-06-01T10:00:00Z",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.target_identifier).toBe("fleet:prod:web-01");
      expect(r.meta.source_label).toBe("cron weekly");
      expect(r.meta.collector_type).toBe("signalforge-collectors");
      expect(r.meta.collector_version).toBe("2.1.0");
      expect(r.meta.collected_at).toBe("2025-06-01T10:00:00.000Z");
    }
  });

  it("rejects non-string fields", () => {
    const r = parseIngestionMeta({ target_identifier: 123 as unknown as string });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/string/i);
  });

  it("rejects invalid collected_at", () => {
    const r = parseIngestionMeta({ collected_at: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ISO/i);
  });

  it("rejects overlong strings", () => {
    const r = parseIngestionMeta({ target_identifier: "x".repeat(600) });
    expect(r.ok).toBe(false);
  });
});

describe("ingestionRecordFromFormData", () => {
  it("reads known keys from FormData", () => {
    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "a.log");
    fd.append("collector_type", "kit");
    fd.append("target_identifier", "t1");
    const rec = ingestionRecordFromFormData(fd);
    expect(rec.collector_type).toBe("kit");
    expect(rec.target_identifier).toBe("t1");
  });
});

describe("inferCollectedAtFromUploadedFile", () => {
  it("prefers file lastModified when available", () => {
    const iso = inferCollectedAtFromUploadedFile(
      { lastModified: Date.UTC(2026, 2, 29, 0, 11, 55) },
      "server_audit_20260329_001155.log"
    );
    expect(iso).toBe("2026-03-29T00:11:55.000Z");
  });

  it("falls back to known collector filename timestamps", () => {
    const iso = inferCollectedAtFromUploadedFile(
      { lastModified: 0 },
      "kubernetes_bundle_monitoring_20260329_001815.json"
    );
    expect(iso).toBe("2026-03-29T00:18:15.000Z");
  });

  it("returns null when there is no usable timestamp hint", () => {
    const iso = inferCollectedAtFromUploadedFile({ lastModified: 0 }, "manual-upload.json");
    expect(iso).toBeNull();
  });
});
