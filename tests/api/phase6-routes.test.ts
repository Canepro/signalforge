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
import * as storageModule from "@/lib/storage";
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
          expected_artifact_type: "windows-evidence-pack",
        }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unsupported expected_artifact_type: "windows-evidence-pack"',
      code: "unsupported_artifact_type",
    });
  });

  it("POST /api/sources validates default_collection_scope against expected_artifact_type", async () => {
    const bad = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Bad scope",
          target_identifier: "tid-bad-default-scope",
          source_type: "linux_host",
          expected_artifact_type: "linux-audit-log",
          default_collection_scope: { kind: "container_target", container_ref: "api" },
        }),
      })
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("invalid_default_collection_scope");

    const good = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Good scope",
          target_identifier: "tid-good-default-scope",
          source_type: "linux_host",
          expected_artifact_type: "container-diagnostics",
          default_collection_scope: { kind: "container_target", container_ref: "api" },
        }),
      })
    );
    expect(good.status).toBe(201);
    expect((await good.json()).default_collection_scope.kind).toBe("container_target");
  });

  it("POST /api/sources rejects default_collection_scope with unknown properties", async () => {
    const res = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Bad extra keys",
          target_identifier: "tid-bad-extra-scope-keys",
          source_type: "linux_host",
          expected_artifact_type: "linux-audit-log",
          default_collection_scope: { kind: "linux_host", unexpected: "value" },
        }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_default_collection_scope");
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

  it("PATCH /api/sources validates default_collection_scope for existing artifact family", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Patch scope",
          target_identifier: "tid-patch-scope",
          source_type: "linux_host",
          expected_artifact_type: "kubernetes-bundle",
        }),
      })
    );
    const { id } = await post.json();

    const bad = await PATCH_SOURCE(
      new NextRequest("http://localhost/api/sources/x", {
        method: "PATCH",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ default_collection_scope: { kind: "linux_host" } }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(bad.status).toBe(400);

    const good = await PATCH_SOURCE(
      new NextRequest("http://localhost/api/sources/x", {
        method: "PATCH",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          default_collection_scope: {
            kind: "kubernetes_scope",
            scope_level: "namespace",
            namespace: "payments",
          },
        }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(good.status).toBe(200);
    expect((await good.json()).default_collection_scope.kind).toBe("kubernetes_scope");
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

  it("GET /api/sources/:id/collection-jobs filters on projected lease status without mutating the row", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Projected list source",
          target_identifier: "tid-projected-list",
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

    const expired = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE collection_jobs
       SET status = 'claimed',
           lease_owner_id = ?,
           lease_owner_instance_id = ?,
           lease_expires_at = ?,
           claimed_at = ?
       WHERE id = ?`,
      ["agent-1", "instance-1", expired, expired, job.id]
    );

    const listed = await GET_SOURCE_JOBS(
      new NextRequest(
        `http://localhost/api/sources/${sourceId}/collection-jobs?status=queued`,
        { headers: authHeaders() }
      ),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.jobs).toHaveLength(1);
    expect(listedBody.jobs[0].id).toBe(job.id);
    expect(listedBody.jobs[0].status).toBe("queued");

    const stmt = db.prepare("SELECT status FROM collection_jobs WHERE id = ?");
    stmt.bind([job.id]);
    expect(stmt.step()).toBe(true);
    expect((stmt.getAsObject() as { status: string }).status).toBe("claimed");
    stmt.free();
  });

  it("GET /api/collection-jobs/:id projects lease expiry without mutating persisted status", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Projected get source",
          target_identifier: "tid-projected-get",
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

    const expired = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE collection_jobs
       SET status = 'running',
           lease_owner_id = ?,
           lease_owner_instance_id = ?,
           lease_expires_at = ?,
           started_at = ?
       WHERE id = ?`,
      ["agent-1", "instance-1", expired, expired, job.id]
    );

    const one = await GET_JOB(
      new NextRequest(`http://localhost/api/collection-jobs/${job.id}`, { headers: authHeaders() }),
      { params: Promise.resolve({ id: job.id }) }
    );
    expect(one.status).toBe(200);
    const oneBody = await one.json();
    expect(oneBody.status).toBe("expired");
    expect(oneBody.error_code).toBe("lease_lost");

    const stmt = db.prepare("SELECT status FROM collection_jobs WHERE id = ?");
    stmt.bind([job.id]);
    expect(stmt.step()).toBe(true);
    expect((stmt.getAsObject() as { status: string }).status).toBe("running");
    stmt.free();
  });

  it("collection job create validates collection_scope by artifact family", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Container source",
          target_identifier: "tid-job-container",
          source_type: "linux_host",
          expected_artifact_type: "container-diagnostics",
        }),
      })
    );
    const { id: sourceId } = await post.json();

    const okJob = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          collection_scope: {
            kind: "container_target",
            runtime: "podman",
            container_ref: "payments-db",
          },
        }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(okJob.status).toBe(201);
    const okBody = await okJob.json();
    expect(okBody.collection_scope.kind).toBe("container_target");

    const badJob = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          collection_scope: {
            kind: "linux_host",
          },
        }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(badJob.status).toBe(400);
    expect((await badJob.json()).code).toBe("invalid_collection_scope");
  });

  it("collection job create rejects kubernetes_scope with empty namespace", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "K8s source",
          target_identifier: "tid-job-k8s-empty-namespace",
          source_type: "linux_host",
          expected_artifact_type: "kubernetes-bundle",
        }),
      })
    );
    const { id: sourceId } = await post.json();

    const res = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          collection_scope: {
            kind: "kubernetes_scope",
            scope_level: "cluster",
            namespace: "",
          },
        }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_collection_scope");
  });

  it("collection job create uses source default_collection_scope when override is omitted", async () => {
    const post = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Default scope source",
          target_identifier: "tid-source-default-job-scope",
          source_type: "linux_host",
          expected_artifact_type: "kubernetes-bundle",
          default_collection_scope: {
            kind: "kubernetes_scope",
            scope_level: "namespace",
            namespace: "payments",
          },
        }),
      })
    );
    const { id: sourceId } = await post.json();

    const jobRes = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ request_reason: "use default scope" }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(jobRes.status).toBe(201);
    const job = await jobRes.json();
    expect(job.collection_scope.kind).toBe("kubernetes_scope");
    expect(job.collection_scope.namespace).toBe("payments");
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

  it("GET /api/sources returns generic 500 when storage listing throws", async () => {
    const spy = vi.spyOn(storageModule, "getStorage").mockResolvedValueOnce({
      sources: {
        list: vi.fn().mockRejectedValueOnce(new Error("SECRET_SOURCE_DETAIL")),
      },
    } as unknown as Awaited<ReturnType<typeof getStorage>>);

    const res = await GET_SOURCES(
      new NextRequest("http://localhost/api/sources", { headers: authHeaders() })
    );

    spy.mockRestore();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });

  it("GET /api/collection-jobs/:id returns generic 500 when storage fails unexpectedly", async () => {
    const spy = vi.spyOn(storageModule, "getStorage").mockResolvedValueOnce({
      withTransaction: vi.fn().mockRejectedValueOnce(new Error("SECRET_JOB_DETAIL")),
    } as unknown as Awaited<ReturnType<typeof getStorage>>);

    const res = await GET_JOB(
      new NextRequest("http://localhost/api/collection-jobs/job-1", { headers: authHeaders() }),
      { params: Promise.resolve({ id: "job-1" }) }
    );

    spy.mockRestore();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });
});
