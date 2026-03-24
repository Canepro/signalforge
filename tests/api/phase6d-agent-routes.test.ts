import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

async function createSourceAndAgent(db: Database, tid: string) {
  process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
  const sres = await POST_SOURCES(
    new NextRequest("http://localhost/api/sources", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "S",
        target_identifier: tid,
        source_type: "linux_host",
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

  it("jobs/next returns gate heartbeat_required before any heartbeat", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-gate-hb");
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
    const j = await next.json();
    expect(j.jobs).toHaveLength(0);
    expect(j.gate).toBe("heartbeat_required");
  });

  it("jobs/next returns gate capabilities_empty when heartbeat sends empty capabilities", async () => {
    const { sourceId, token } = await createSourceAndAgent(db, "tid-gate-empty");
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
