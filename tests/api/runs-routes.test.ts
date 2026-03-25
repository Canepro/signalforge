import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/runs/route";
import { GET as GET_RUN } from "@/app/api/runs/[id]/route";
import { GET as GET_REPORT } from "@/app/api/runs/[id]/report/route";
import * as repository from "@/lib/db/repository";
import * as dbClient from "@/lib/db/client";
import * as domainEvents from "@/lib/domain-events";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";

describe("API /api/runs", () => {
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

  it("POST returns generic 500 without leaking exception details", async () => {
    vi.spyOn(repository, "insertArtifact").mockImplementationOnce(() => {
      throw new Error("SECRET_INTERNAL_DETAIL");
    });
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "x",
        filename: "f.log",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error", code: "internal_error" });
  });

  it("POST JSON returns 400 when content is missing", async () => {
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "x.log" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/content/i);
  });

  it("POST JSON returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid json/i);
  });

  it("POST multipart returns 400 when file is missing", async () => {
    const form = new FormData();
    form.append("note", "no file");
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      body: form,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST JSON happy path persists and calls saveDb", async () => {
    const log = `=== signalforge-collectors ===
hostname: test-host
=== uname -a ===
Linux test 5.0 x86_64
`;
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: log,
        filename: "from-api.json.log",
        source_type: "api",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(dbClient.saveDb).toHaveBeenCalled();

    const body = await res.json();
    expect(body.run_id).toBeTruthy();
    expect(body.artifact_id).toBeTruthy();
    expect(body.status).toBeTruthy();

    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.runs.length).toBe(1);
    expect(list.runs[0].filename).toBe("from-api.json.log");
    expect(list.runs[0].source_type).toBe("api");

    const detailRes = await GET_RUN(new NextRequest("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: body.run_id }),
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.filename).toBe("from-api.json.log");
    expect(detail.source_type).toBe("api");
    expect(detail.links).toEqual({
      compare_ui: `/runs/${body.run_id}/compare`,
      compare_api: `/api/runs/${body.run_id}/compare`,
    });

    const reportRes = await GET_REPORT(new NextRequest("http://localhost/api/runs/x/report"), {
      params: Promise.resolve({ id: body.run_id }),
    });
    expect(reportRes.status).toBe(200);
    const report = await reportRes.json();
    expect(report).toHaveProperty("findings");
  });

  it("POST multipart stores per-submission filename and source_type even when content matches a prior JSON upload", async () => {
    const log = `=== signalforge-collectors ===
hostname: dup-test
=== uname -a ===
Linux dup 5.0 x86_64
`;

    const jsonReq = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: log, filename: "first.json", source_type: "api" }),
    });
    expect((await POST(jsonReq)).status).toBe(200);

    const form = new FormData();
    form.append("file", new Blob([log], { type: "text/plain" }), "second-upload.log");
    const mpReq = new NextRequest("http://localhost/api/runs", { method: "POST", body: form });
    const mpRes = await POST(mpReq);
    expect(mpRes.status).toBe(200);

    const listRes = await GET();
    const list = (await listRes.json()).runs as { filename: string; source_type: string }[];
    expect(list).toHaveLength(2);
    const byFile = Object.fromEntries(list.map((r) => [r.filename, r]));
    expect(byFile["first.json"].source_type).toBe("api");
    expect(byFile["second-upload.log"].source_type).toBe("upload");
  });

  it("GET /api/runs/[id] returns 404 for unknown id", async () => {
    const res = await GET_RUN(new NextRequest("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/[id]/report returns 404 for unknown id", async () => {
    const res = await GET_REPORT(new NextRequest("http://localhost/api/runs/x/report"), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST JSON accepts optional Phase 5a ingestion metadata and persists it", async () => {
    const log = `=== signalforge-collectors ===
hostname: meta-test
=== uname -a ===
Linux meta 5.0 x86_64
`;
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: log,
        filename: "meta.json.log",
        source_type: "api",
        target_identifier: "fleet:staging:app-1",
        source_label: "weekly job",
        collector_type: "signalforge-collectors",
        collector_version: "1.2.3",
        collected_at: "2025-03-01T08:30:00.000Z",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run_id: string };

    const detailRes = await GET_RUN(new NextRequest("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: body.run_id }),
    });
    const detail = await detailRes.json();
    expect(detail.target_identifier).toBe("fleet:staging:app-1");
    expect(detail.source_label).toBe("weekly job");
    expect(detail.collector_type).toBe("signalforge-collectors");
    expect(detail.collector_version).toBe("1.2.3");
    expect(detail.collected_at).toBe("2025-03-01T08:30:00.000Z");

    const listRes = await GET();
    const list = (await listRes.json()).runs as {
      target_identifier: string | null;
      collector_type: string | null;
    }[];
    expect(list[0].target_identifier).toBe("fleet:staging:app-1");
    expect(list[0].collector_type).toBe("signalforge-collectors");
  });

  it("POST JSON returns 400 for invalid ingestion metadata", async () => {
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "=== x ===\n",
        filename: "bad.log",
        collected_at: "not iso",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST JSON returns 400 for unsupported artifact_type", async () => {
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "=== x ===\n",
        filename: "bad.log",
        artifact_type: "container-diagnostics",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unsupported artifact_type: "container-diagnostics"',
      code: "unsupported_artifact_type",
    });
  });

  it("POST JSON emits run lifecycle events after persistence", async () => {
    const emitSpy = vi
      .spyOn(domainEvents, "emitRunLifecycleEvents")
      .mockImplementation(() => {});

    const log = `=== signalforge-collectors ===
hostname: event-host
=== uname -a ===
Linux event 5.0 x86_64
`;
    const req = new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: log,
        filename: "event.log",
        source_type: "api",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      run_id: string;
      artifact_id: string;
      status: string;
    };

    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: body.run_id,
        artifact_id: body.artifact_id,
        status: body.status,
      })
    );
  });

  it("POST multipart carries ingestion fields as optional form parts", async () => {
    const log = `=== signalforge-collectors ===
hostname: mp-test
=== uname -a ===
Linux mp 5.0 x86_64
`;
    const form = new FormData();
    form.append("file", new Blob([log], { type: "text/plain" }), "mp.log");
    form.append("target_identifier", "id-from-form");
    form.append("collector_type", "manual-script");
    const mpRes = await POST(new NextRequest("http://localhost/api/runs", { method: "POST", body: form }));
    expect(mpRes.status).toBe(200);
    const { run_id } = (await mpRes.json()) as { run_id: string };
    const detailRes = await GET_RUN(new NextRequest("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: run_id }),
    });
    const detail = await detailRes.json();
    expect(detail.target_identifier).toBe("id-from-form");
    expect(detail.collector_type).toBe("manual-script");
  });
});
