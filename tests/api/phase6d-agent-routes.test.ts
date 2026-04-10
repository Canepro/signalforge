import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { File } from "undici";
import { NextRequest } from "next/server";
import { POST as POST_SOURCES } from "@/app/api/sources/route";
import { POST as POST_REG } from "@/app/api/agent/registrations/route";
import {
  GET as GET_SOURCE_JOBS,
  POST as POST_SOURCE_JOBS,
} from "@/app/api/sources/[id]/collection-jobs/route";
import { POST as POST_HEARTBEAT } from "@/app/api/agent/heartbeat/route";
import { GET as GET_NEXT } from "@/app/api/agent/jobs/next/route";
import { POST as POST_CLAIM } from "@/app/api/collection-jobs/[id]/claim/route";
import { POST as POST_START } from "@/app/api/collection-jobs/[id]/start/route";
import { POST as POST_FAIL } from "@/app/api/collection-jobs/[id]/fail/route";
import { POST as POST_ARTIFACT } from "@/app/api/collection-jobs/[id]/artifact/route";
import * as dbClient from "@/lib/db/client";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";
import type { AnalysisResult } from "@/lib/analyzer/schema";
import * as analyzer from "@/lib/analyzer/index";
import * as sourceJobRepo from "@/lib/db/source-job-repository";
import { getArtifactById, getRun } from "@/lib/db/repository";

const ADMIN = "admin-phase6d";
const agentAuth = (t: string) => ({ authorization: `Bearer ${t}` });
const adminAuth = { authorization: `Bearer ${ADMIN}` };

const SAMPLE_LOG = `=== server-audit-kit ===
hostname: agent-test-host
=== uname -a ===
Linux test 5.0 x86_64
`;

async function createSourceAndAgent(
  db: Database,
  tid: string,
  opts?: {
    expected_artifact_type?: "linux-audit-log" | "container-diagnostics" | "kubernetes-bundle";
    default_collection_scope?: Record<string, unknown>;
  }
) {
  process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
  const sres = await POST_SOURCES(
    new NextRequest("http://localhost/api/sources", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "S",
        target_identifier: tid,
        source_type: "linux_host",
        expected_artifact_type: opts?.expected_artifact_type,
        default_collection_scope: opts?.default_collection_scope,
      }),
    })
  );
  const s = await sres.json();
  const rres = await POST_REG(
    new NextRequest("http://localhost/api/agent/registrations", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({ source_id: s.id }),
    })
  );
  const reg = await rres.json();
  return { sourceId: s.id as string, token: reg.token as string };
}

describe("Phase 6d agent routes", () => {
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
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
  });

  it("heartbeat returns 401 without bearer", async () => {
    const res = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: [],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("jobs/next rejects source_id query param with 400", async () => {
    const { token } = await createSourceAndAgent(db, "tid-next-q");
    const res = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next?source_id=x", {
        headers: agentAuth(token),
      })
    );
    expect(res.status).toBe(400);
  });

  it("jobs/next rejects invalid wait_seconds with 400", async () => {
    const { token } = await createSourceAndAgent(db, "tid-next-wait-bad");
    const res = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next?wait_seconds=-1", {
        headers: agentAuth(token),
      })
    );
    expect(res.status).toBe(400);
  });

  it("jobs/next returns gate heartbeat_required before any heartbeat", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-gate-hb");
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({
          collection_scope: {
            kind: "linux_host",
          },
        }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    expect(next.status).toBe(200);
    const j = await next.json();
    expect(j.jobs).toHaveLength(0);
    expect(j.gate).toBe("heartbeat_required");
  });

  it("jobs/next returns gate capabilities_empty when heartbeat sends empty capabilities", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-gate-empty");
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({
          collection_scope: { kind: "linux_host" },
        }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: [],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    const j = await next.json();
    expect(j.jobs).toHaveLength(0);
    expect(j.gate).toBe("capabilities_empty");
  });

  it("jobs/next reaps expired claimed leases before listing queued jobs", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-next-reap-expired-claimed");

    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );

    const queued = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const job = await queued.json();

    const expired = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE collection_jobs
       SET status = 'claimed',
           lease_owner_id = ?,
           lease_owner_instance_id = ?,
           lease_expires_at = ?,
           claimed_at = ?
       WHERE id = ?`,
      ["other-agent", "other-instance", expired, expired, job.id]
    );

    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    expect(next.status).toBe(200);
    const nextBody = await next.json();
    expect(nextBody.gate).toBeNull();
    expect(nextBody.jobs).toHaveLength(1);
    expect(nextBody.jobs[0].id).toBe(job.id);

    const stmt = db.prepare("SELECT status, lease_owner_id FROM collection_jobs WHERE id = ?");
    stmt.bind([job.id]);
    expect(stmt.step()).toBe(true);
    const row = stmt.getAsObject() as { status: string; lease_owner_id: string | null };
    expect(row.status).toBe("queued");
    expect(row.lease_owner_id).toBeNull();
    stmt.free();
  });

  it("heartbeat reaps expired claimed leases without active_job_id", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-heartbeat-reap-expired-claimed");

    const queued = await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const job = await queued.json();

    const expired = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE collection_jobs
       SET status = 'claimed',
           lease_owner_id = ?,
           lease_owner_instance_id = ?,
           lease_expires_at = ?,
           claimed_at = ?
       WHERE id = ?`,
      ["other-agent", "other-instance", expired, expired, job.id]
    );

    const hb = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    expect(hb.status).toBe(200);
    expect((await hb.json()).active_job_lease).toBeNull();

    const stmt = db.prepare("SELECT status, lease_owner_id FROM collection_jobs WHERE id = ?");
    stmt.bind([job.id]);
    expect(stmt.step()).toBe(true);
    const row = stmt.getAsObject() as { status: string; lease_owner_id: string | null };
    expect(row.status).toBe("queued");
    expect(row.lease_owner_id).toBeNull();
    stmt.free();
  });

  it("jobs/next long-poll returns a newly queued job during wait window", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-next-wait");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );

    const nextPromise = GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next?wait_seconds=1", {
        headers: agentAuth(token),
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );

    const next = await nextPromise;
    expect(next.status).toBe(200);
    const body = await next.json();
    expect(body.gate).toBeNull();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].source_id).toBe(sourceId);
  });

  it("jobs/next includes explicit collection_scope from queued jobs", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-next-scope-explicit", {
      expected_artifact_type: "container-diagnostics",
    });
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:container-diagnostics"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({
          collection_scope: {
            kind: "container_target",
            runtime: "docker",
            container_ref: "payments-api",
          },
        }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    expect(next.status).toBe(200);
    const body = await next.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].collection_scope?.kind).toBe("container_target");
    expect(body.jobs[0].collection_scope?.container_ref).toBe("payments-api");
  });

  it("jobs/next includes source default scope when queued job omits override", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-next-scope-default", {
      expected_artifact_type: "kubernetes-bundle",
      default_collection_scope: {
        kind: "kubernetes_scope",
        scope_level: "namespace",
        namespace: "payments",
      },
    });
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:kubernetes-bundle"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ request_reason: "defaulted scope job" }),
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    expect(next.status).toBe(200);
    const body = await next.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].collection_scope?.kind).toBe("kubernetes_scope");
    expect(body.jobs[0].collection_scope?.namespace).toBe("payments");
  });

  it("happy path: heartbeat → next → claim → start → artifact → submitted", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-happy");

    const hb = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log", "upload:multipart"],
          attributes: { os: "linux" },
          agent_version: "0.1.0",
          active_job_id: null,
        }),
      })
    );
    expect(hb.status).toBe(200);
    expect((await hb.json()).active_job_lease).toBeNull();

    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );

    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    expect(next.status).toBe(200);
    const jn = await next.json();
    expect(jn.jobs).toHaveLength(1);
    expect(jn.gate).toBeNull();
    const jobId = jn.jobs[0].id as string;

    const claim = await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "proc-1", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(claim.status).toBe(200);
    expect((await claim.json()).status).toBe("claimed");

    const start = await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "proc-1" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(start.status).toBe(200);
    expect((await start.json()).status).toBe("running");

    const form = new FormData();
    form.append("instance_id", "proc-1");
    form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "audit.log");
    const art = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: form,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(art.status).toBe(200);
    const body = await art.json();
    expect(body.run_id).toBeTruthy();
    expect(body.artifact_id).toBeTruthy();
    expect(body.job.status).toBe("submitted");
    expect(body.run_status).toBe("complete");
    expect(body.job.result_analysis_status).toBe("complete");
    expect(dbClient.saveDb).toHaveBeenCalled();
  });

  it("artifact upload returns 409 when uploaded artifact_type mismatches the job", async () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;

    db.run(
      `INSERT INTO sources (
        id, display_name, target_identifier, target_identifier_norm, source_type, expected_artifact_type,
        default_collector_type, default_collector_version, capabilities_json, attributes_json, labels_json, enabled,
        last_seen_at, health_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unknown', ?, ?)`,
      [
        "src-mismatch",
        "Mismatch Source",
        "mismatch-target",
        "mismatch-target",
        "linux_host",
        "container-diagnostics",
        "signalforge-collectors",
        null,
        JSON.stringify(["collect:container-diagnostics"]),
        "{}",
        "{}",
        1,
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
      ]
    );
    db.run(
      `INSERT INTO agent_registrations (
        id, source_id, token_hash, display_name, created_at, last_capabilities_json, last_heartbeat_at, last_agent_version, last_instance_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "reg-mismatch",
        "src-mismatch",
        sourceJobRepo.hashAgentToken("tok-mismatch"),
        "Mismatch Agent",
        "2026-03-25T00:00:00.000Z",
        JSON.stringify(["collect:container-diagnostics"]),
        "2026-03-25T00:00:00.000Z",
        "0.1.0",
        "proc-mismatch",
      ]
    );
    db.run(
      `INSERT INTO collection_jobs (
        id, source_id, artifact_type, status, requested_by, request_reason, priority,
        idempotency_key, lease_owner_id, lease_owner_instance_id, lease_expires_at, last_heartbeat_at,
        result_artifact_id, result_run_id, error_code, error_message,
        created_at, updated_at, queued_at, claimed_at, started_at, submitted_at, finished_at, result_analysis_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [
        "job-mismatch",
        "src-mismatch",
        "container-diagnostics",
        "running",
        "operator",
        null,
        0,
        null,
        "reg-mismatch",
        "proc-mismatch",
        "2999-01-01T00:00:00.000Z",
        null,
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
      ]
    );

    const form = new FormData();
    form.append("instance_id", "proc-mismatch");
    form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "audit.log");

    const res = await POST_ARTIFACT(
      new NextRequest("http://localhost/api/collection-jobs/job-mismatch/artifact", {
        method: "POST",
        headers: agentAuth("tok-mismatch"),
        body: form,
      }),
      { params: Promise.resolve({ id: "job-mismatch" }) }
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Uploaded artifact_type does not match the requested job artifact_type",
      code: "artifact_type_mismatch",
    });
  });

  it("claim wrong source returns 403", async () => {
    const { token } = await createSourceAndAgent(db, "tid-a");
    const { sourceId: s2 } = await createSourceAndAgent(db, "tid-b");

    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${s2}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: s2 }) }
    );
    const list = await GET_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${s2}/collection-jobs`, { headers: adminAuth }),
      { params: Promise.resolve({ id: s2 }) }
    );
    const j = (await list.json()).jobs[0];

    const claim = await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${j.id}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "x", lease_ttl_seconds: 120 }),
      }),
      { params: Promise.resolve({ id: j.id }) }
    );
    expect(claim.status).toBe(403);
  });

  it("double claim returns 409", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-dup");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    const jobId = (await next.json()).jobs[0].id;

    const c1 = await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "i1", lease_ttl_seconds: 120 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(c1.status).toBe(200);

    const c2 = await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "i2", lease_ttl_seconds: 120 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(c2.status).toBe(409);
  });

  it("strict capability gating returns capability_mismatch when collect:* missing", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-cap");

    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );

    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["upload:multipart"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );

    const n1 = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    const j1 = await n1.json();
    expect(j1.jobs.length).toBe(0);
    expect(j1.gate).toBe("capability_mismatch");
  });

  it("fail from claimed works with matching instance_id", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-fail");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;

    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "f1", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    const fail = await POST_FAIL(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/fail`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          instance_id: "f1",
          code: "collector_failed",
          message: "exit 1",
        }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(fail.status).toBe(200);
    expect((await fail.json()).status).toBe("failed");
  });

  it("start fails 400 without instance_id", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-no-inst");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "s1", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    const st = await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(st.status).toBe(400);
    expect((await st.json()).code).toBe("instance_id_required");
  });

  it("start and fail return 403 instance_mismatch for wrong instance_id", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-wrong-i");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "good", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    const st = await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "bad" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(st.status).toBe(403);
    expect((await st.json()).code).toBe("instance_mismatch");

    const fl = await POST_FAIL(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/fail`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "bad", code: "x", message: "y" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(fl.status).toBe(403);
    expect((await fl.json()).code).toBe("instance_mismatch");
  });

  it("artifact requires instance_id and rejects mismatch", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-art-inst");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "run-a", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "run-a" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    const formNoInst = new FormData();
    formNoInst.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "a.log");
    const r0 = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: formNoInst,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(r0.status).toBe(400);
    expect((await r0.json()).code).toBe("instance_id_required");

    const formBad = new FormData();
    formBad.append("instance_id", "other");
    formBad.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "a.log");
    const r1 = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: formBad,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(r1.status).toBe(403);
    expect((await r1.json()).code).toBe("instance_mismatch");
  });

  it("artifact upload cleans up the new run when job submission loses the race", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-art-conflict");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    const jobId = (await next.json()).jobs[0].id as string;

    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "proc-clean", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "proc-clean" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    const submitSpy = vi
      .spyOn(sourceJobRepo, "markCollectionJobSubmittedForAgent")
      .mockReturnValueOnce(null);

    const form = new FormData();
    form.append("instance_id", "proc-clean");
    form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "cleanup.log");
    const art = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: form,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    expect(art.status).toBe(409);
    const body = await art.json();
    expect(body.code).toBe("conflict");
    expect(submitSpy).toHaveBeenCalledOnce();

    const args = submitSpy.mock.calls[0];
    const artifactId = args[5] as string;
    const runId = args[6] as string;
    expect(getRun(db, runId)).toBeNull();
    expect(getArtifactById(db, artifactId)).toBeNull();
  });

  it("artifact upload infers collected_at from uploaded file metadata when omitted", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-art-collected-at");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) })
    );
    const jobId = (await next.json()).jobs[0].id as string;

    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "ts-a", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "ts-a" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    const form = new FormData();
    form.append("instance_id", "ts-a");
    form.append(
      "file",
      new File([SAMPLE_LOG], "server_audit_20260329_001155.log", {
        type: "text/plain",
        lastModified: Date.UTC(2026, 2, 29, 0, 11, 55),
      })
    );
    const art = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: form,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    expect(art.status).toBe(200);
    const body = await art.json();
    const run = getRun(db, body.run_id as string);
    expect(run?.collected_at).toBe("2026-03-29T00:11:55.000Z");
  });

  it("heartbeat with active_job_id requires instance_id and validates lease", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-hb-job");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "hb1", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    const bad = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: jobId,
        }),
      })
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("instance_id_required");

    const bad2 = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: jobId,
          instance_id: "wrong",
        }),
      })
    );
    expect(bad2.status).toBe(403);
    expect((await bad2.json()).code).toBe("instance_mismatch");

    const ok = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: jobId,
          instance_id: "hb1",
        }),
      })
    );
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.active_job_lease?.extended).toBe(true);
    expect(okBody.active_job_lease?.job_id).toBe(jobId);
    expect(okBody.active_job_lease?.lease_expires_at).toBeTruthy();
  });

  it("heartbeat with active_job_id returns lease_expired after running lease is reaped", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-hb-active-reaped");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;

    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "hb-exp", lease_ttl_seconds: 120 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "hb-exp" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    db.run(`UPDATE collection_jobs SET lease_expires_at = ? WHERE id = ?`, [
      new Date(Date.now() - 60_000).toISOString(),
      jobId,
    ]);

    const hb = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: jobId,
          instance_id: "hb-exp",
        }),
      })
    );

    expect(hb.status).toBe(409);
    expect((await hb.json()).code).toBe("lease_expired");
  });

  it("artifact duplicate returns 409 job_already_submitted", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-dup-art");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "d1", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "d1" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    const form = new FormData();
    form.append("instance_id", "d1");
    form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "a.log");
    const a1 = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: form,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(a1.status).toBe(200);

    const form2 = new FormData();
    form2.append("instance_id", "d1");
    form2.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "b.log");
    const a2 = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: agentAuth(token),
        body: form2,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(a2.status).toBe(409);
    const j = await a2.json();
    expect(j.code).toBe("job_already_submitted");
  });

  it("start after expired lease returns 409", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-lease");
    await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    await POST_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        method: "POST",
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
    await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "l1", lease_ttl_seconds: 120 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );

    db.run(`UPDATE collection_jobs SET lease_expires_at = ? WHERE id = ?`, [
      "2000-01-01T00:00:00.000Z",
      jobId,
    ]);

    const st = await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "l1" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(st.status).toBe(409);
  });

  it("heartbeat returns generic 500 when applyAgentHeartbeat throws", async () => {
    const { token } = await createSourceAndAgent(db, "tid-hb-500");
    const spy = vi.spyOn(sourceJobRepo, "applyAgentHeartbeat").mockImplementationOnce(() => {
      throw new Error("SECRET_DB_DETAIL");
    });
    const res = await POST_HEARTBEAT(
      new NextRequest("http://localhost/api/agent/heartbeat", {
        method: "POST",
        headers: { ...agentAuth(token), "content-type": "application/json" },
        body: JSON.stringify({
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agent_version: "1",
          active_job_id: null,
        }),
      })
    );
    spy.mockRestore();
    expect(res.status).toBe(500);
    const b = await res.json();
    expect(b).toEqual({ error: "Internal server error", code: "internal_error" });
  });

  describe("artifact with analyzer error result (mocked)", () => {
    const env = {
      hostname: "h",
      os: "Linux",
      kernel: "k",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: false,
      uptime: "0",
    } as const;

    const errResult: AnalysisResult = {
      report: null,
      analysis_error: "simulated pipeline failure",
      environment: { ...env },
      noise: [],
      pre_findings: [],
      is_incomplete: false,
      meta: {
        model_used: "none",
        tokens_used: 0,
        duration_ms: 0,
        llm_succeeded: false,
      },
    };

    let restoreAnalyze: (() => void) | undefined;
    beforeEach(() => {
      const s = vi.spyOn(analyzer, "analyzeArtifact").mockResolvedValue(errResult);
      restoreAnalyze = () => s.mockRestore();
    });

    afterEach(() => {
      restoreAnalyze?.();
    });

    it("job stays submitted with result_analysis_status error and run_status error", async () => {
      const { sourceId, token } = await createSourceAndAgent(db, "tid-an-err");
      await POST_HEARTBEAT(
        new NextRequest("http://localhost/api/agent/heartbeat", {
          method: "POST",
          headers: { ...agentAuth(token), "content-type": "application/json" },
          body: JSON.stringify({
            capabilities: ["collect:linux-audit-log"],
            attributes: {},
            agent_version: "1",
            active_job_id: null,
          }),
        })
      );
      await POST_SOURCE_JOBS(
        new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
          method: "POST",
          headers: adminAuth,
        }),
        { params: Promise.resolve({ id: sourceId }) }
      );
      const jobId = (await (await GET_NEXT(new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(token) }))).json()).jobs[0].id;
      await POST_CLAIM(
        new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
          method: "POST",
          headers: { ...agentAuth(token), "content-type": "application/json" },
          body: JSON.stringify({ instance_id: "ae1", lease_ttl_seconds: 300 }),
        }),
        { params: Promise.resolve({ id: jobId }) }
      );
      await POST_START(
        new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
          method: "POST",
          headers: { ...agentAuth(token), "content-type": "application/json" },
          body: JSON.stringify({ instance_id: "ae1" }),
        }),
        { params: Promise.resolve({ id: jobId }) }
      );
      const form = new FormData();
      form.append("instance_id", "ae1");
      form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "audit.log");
      const art = await POST_ARTIFACT(
        new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
          method: "POST",
          headers: agentAuth(token),
          body: form,
        }),
        { params: Promise.resolve({ id: jobId }) }
      );
      expect(art.status).toBe(200);
      const body = await art.json();
      expect(body.job.status).toBe("submitted");
      expect(body.run_status).toBe("error");
      expect(body.job.result_analysis_status).toBe("error");
    });
  });
});
