import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as POST_SOURCES, GET as GET_SOURCES } from "@/app/api/sources/route";
import { GET as GET_SOURCE, PATCH as PATCH_SOURCE, DELETE as DELETE_SOURCE } from "@/app/api/sources/[id]/route";
import {
  GET as GET_SOURCE_JOBS,
  POST as POST_SOURCE_JOBS,
} from "@/app/api/sources/[id]/collection-jobs/route";
import { GET as GET_JOB } from "@/app/api/collection-jobs/[id]/route";
import { POST as POST_CANCEL } from "@/app/api/collection-jobs/[id]/cancel/route";
import { POST as POST_AGENT_REG } from "@/app/api/agent/registrations/route";
import * as dbClient from "@/lib/db/client";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";
import { getStorage } from "@/lib/storage";

const ADMIN = "test-admin-token-phase6";

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${ADMIN}` };
}

describe("Phase 6 API routes", () => {
  let db: Database;

  beforeEach(async () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
    db = await getTestDb();
    dbClient.setDbOverride(db);
    vi.spyOn(dbClient, "saveDb");
  });

  afterEach(() => {
    dbClient.setDbOverride(null);
    db.close();
    vi.restoreAllMocks();
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
  });

  it("GET /api/sources returns 503 when admin token unset", async () => {
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
    const res = await GET_SOURCES(new NextRequest("http://localhost/api/sources"));
    expect(res.status).toBe(503);
  });

  it("GET /api/sources returns 401 without bearer", async () => {
    const res = await GET_SOURCES(new NextRequest("http://localhost/api/sources"));
    expect(res.status).toBe(401);
  });

  it("POST /api/sources creates source and GET lists it", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "My host",
          target_identifier: "prod-1",
          source_type: "linux_host",
        }),
      })
    );
    expect(post.status).toBe(201);
    expect(dbClient.saveDb).toHaveBeenCalled();
    const body = await post.json();
    expect(body.id).toBeTruthy();
    expect(body.expected_artifact_type).toBe("linux-audit-log");

    const list = await GET_SOURCES(
      new NextRequest("http://localhost/api/sources", { headers: authHeaders() })
    );
    expect(list.status).toBe(200);
    const j = await list.json();
    expect(j.sources).toHaveLength(1);
  });

  it("POST /api/sources returns 409 duplicate target_identifier", async () => {
    const opts = {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "A",
        target_identifier: "dup-tid",
        source_type: "wsl",
      }),
    };
    await POST_SOURCES(new NextRequest("http://localhost/api/sources", opts));
    const second = await POST_SOURCES(new NextRequest("http://localhost/api/sources", opts));
    expect(second.status).toBe(409);
  });

  it("POST /api/sources rejects unsupported expected_artifact_type", async () => {
    const res = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Bad",
          target_identifier: "bad-artifact-type",
          source_type: "linux_host",
          expected_artifact_type: "kubernetes-bundle",
        }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unsupported expected_artifact_type: "kubernetes-bundle"',
      code: "unsupported_artifact_type",
    });
  });

  it("PATCH /api/sources rejects immutable fields", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "P",
          target_identifier: "tid-patch",
          source_type: "linux_host",
        }),
      })
    );
    const { id } = await post.json();
    const patch = await PATCH_SOURCE(
      new NextRequest("http://localhost/api/sources/x", {
        method: "PATCH",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ target_identifier: "nope" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(patch.status).toBe(400);
  });

  it("collection job create and get", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "J",
          target_identifier: "tid-job",
          source_type: "linux_host",
        }),
      })
    );
    const { id: sourceId } = await post.json();

    const jobRes = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ request_reason: "r1" }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(jobRes.status).toBe(201);
    const job = await jobRes.json();
    expect(job.status).toBe("queued");

    const one = await GET_JOB(
      new NextRequest(`http://localhost/api/collection-jobs/${job.id}`, { headers: authHeaders() }),
      { params: Promise.resolve({ id: job.id }) }
    );
    expect(one.status).toBe(200);
  });

  it("POST /api/agent/registrations returns 409 for second registration", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "A",
          target_identifier: "tid-agent",
          source_type: "linux_host",
        }),
      })
    );
    const { id: sourceId } = await post.json();

    const r1 = await POST_AGENT_REG(
      new NextRequest("http://localhost/api/agent/registrations", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(r1.status).toBe(201);
    const r2 = await POST_AGENT_REG(
      new NextRequest("http://localhost/api/agent/registrations", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(r2.status).toBe(409);
  });

  it("cancel job from queued", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "C",
          target_identifier: "tid-can",
          source_type: "linux_host",
        }),
      })
    );
    const { id: sourceId } = await post.json();
    const jobRes = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const job = await jobRes.json();
    const cancel = await POST_CANCEL(
      new NextRequest(`http://localhost/api/collection-jobs/${job.id}/cancel`, {
        method: "POST",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    expect(cancel.status).toBe(200);
    const j = await cancel.json();
    expect(j.status).toBe("cancelled");
  });

  it("DELETE /api/sources/:id removes a source and returns 404 afterward", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Delete Me",
          target_identifier: "tid-delete",
          source_type: "linux_host",
        }),
      })
    );
    const { id } = await post.json();

    const del = await DELETE_SOURCE(
      new NextRequest(`http://localhost/api/sources/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(del.status).toBe(200);

    const get = await GET_SOURCE(
      new NextRequest(`http://localhost/api/sources/${id}`, { headers: authHeaders() }),
      { params: Promise.resolve({ id }) }
    );
    expect(get.status).toBe(404);
  });

  it("DELETE /api/sources/:id returns 409 when a job is claimed", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Claimed Source",
          target_identifier: "tid-delete-claimed",
          source_type: "wsl",
        }),
      })
    );
    const { id: sourceId } = await post.json();

    const storage = await getStorage();
    const { row: reg } = await storage.withTransaction((tx) =>
      tx.agents.createRegistration(sourceId, "api-delete-agent")
    );
    await storage.withTransaction((tx) =>
      tx.agents.applyHeartbeat({
        sourceId,
        registrationId: reg.id,
        capabilities: ["collect:linux-audit-log"],
        attributes: {},
        agentVersion: "0.1.0",
        activeJobId: null,
        instanceId: null,
      })
    );
    const { row: job } = await storage.withTransaction((tx) =>
      tx.jobs.queueForSource(sourceId, { request_reason: "delete route block" })
    );
    await storage.withTransaction((tx) =>
      tx.jobs.claimForAgent(job.id, sourceId, reg.id, "api-delete-inst", 300)
    );

    const del = await DELETE_SOURCE(
      new NextRequest(`http://localhost/api/sources/${sourceId}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(del.status).toBe(409);
    const body = await del.json();
    expect(body.code).toBe("active_jobs");
  });
});
