import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Database } from "sql.js";
import type { AnalysisResult } from "@/lib/analyzer/schema";
import { getTestDb } from "@/lib/db/client";
import * as dbClient from "@/lib/db/client";
import * as analyzer from "@/lib/analyzer/index";
import { POST as POST_SOURCES } from "@/app/api/sources/route";
import { POST as POST_AGENT_REG } from "@/app/api/agent/registrations/route";
import { POST as POST_AUTOMATION_REG } from "@/app/api/automation-agent/registrations/route";
import { POST as POST_AUTOMATION_ROTATE } from "@/app/api/automation-agent/registrations/rotate/route";
import { POST as POST_AUTOMATION_REQUEST } from "@/app/api/automation-agent/diagnostic-requests/route";
import { GET as GET_AUTOMATION_REQUEST } from "@/app/api/automation-agent/diagnostic-requests/[id]/route";
import { POST as POST_HEARTBEAT } from "@/app/api/agent/heartbeat/route";
import { GET as GET_NEXT } from "@/app/api/agent/jobs/next/route";
import { POST as POST_CLAIM } from "@/app/api/collection-jobs/[id]/claim/route";
import { POST as POST_START } from "@/app/api/collection-jobs/[id]/start/route";
import { POST as POST_FAIL } from "@/app/api/collection-jobs/[id]/fail/route";
import { POST as POST_ARTIFACT } from "@/app/api/collection-jobs/[id]/artifact/route";

const ADMIN = "admin-automation-api";
const adminAuth = { authorization: `Bearer ${ADMIN}` };
const executionAuth = (token: string) => ({ authorization: `Bearer ${token}` });
const automationAuth = (token: string) => ({ authorization: `Bearer ${token}` });

const SAMPLE_LOG = `=== server-audit-kit ===
hostname: automation-agent-host
=== uname -a ===
Linux test 5.0 x86_64
`;

async function createSource(
  tid: string,
  db: Database
): Promise<{ sourceId: string }> {
  process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
  const res = await POST_SOURCES(
    new NextRequest("http://localhost/api/sources", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({
        display_name: `Source ${tid}`,
        target_identifier: tid,
        source_type: "linux_host",
      }),
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return { sourceId: body.id as string };
}

async function enrollExecutionAgent(sourceId: string) {
  const res = await POST_AGENT_REG(
    new NextRequest("http://localhost/api/agent/registrations", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({ source_id: sourceId }),
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.token as string;
}

async function enrollAutomationAgent(sourceId: string) {
  const res = await POST_AUTOMATION_REG(
    new NextRequest("http://localhost/api/automation-agent/registrations", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({ source_id: sourceId }),
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.token as string;
}

async function heartbeatExecutionAgent(token: string) {
  const res = await POST_HEARTBEAT(
    new NextRequest("http://localhost/api/agent/heartbeat", {
      method: "POST",
      headers: { ...executionAuth(token), "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: ["collect:linux-audit-log"],
        attributes: {},
        agent_version: "1",
        active_job_id: null,
      }),
    })
  );
  expect(res.status).toBe(200);
}

async function queueAutomationRequest(token: string, body?: Record<string, unknown>) {
  return POST_AUTOMATION_REQUEST(
    new NextRequest("http://localhost/api/automation-agent/diagnostic-requests", {
      method: "POST",
      headers: { ...automationAuth(token), "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
  );
}

async function getAutomationRequest(token: string, requestId: string) {
  return GET_AUTOMATION_REQUEST(
    new NextRequest(`http://localhost/api/automation-agent/diagnostic-requests/${requestId}`, {
      headers: automationAuth(token),
    }),
    { params: Promise.resolve({ id: requestId }) }
  );
}

async function advanceJobToRunning(executionToken: string): Promise<{ jobId: string; instanceId: string }> {
  const next = await GET_NEXT(
    new NextRequest("http://localhost/api/agent/jobs/next", {
      headers: executionAuth(executionToken),
    })
  );
  expect(next.status).toBe(200);
  const nextBody = await next.json();
  const jobId = nextBody.jobs[0].id as string;
  const instanceId = "automation-exec-1";

  const claim = await POST_CLAIM(
    new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
      method: "POST",
      headers: { ...executionAuth(executionToken), "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, lease_ttl_seconds: 300 }),
    }),
    { params: Promise.resolve({ id: jobId }) }
  );
  expect(claim.status).toBe(200);

  const start = await POST_START(
    new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
      method: "POST",
      headers: { ...executionAuth(executionToken), "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId }),
    }),
    { params: Promise.resolve({ id: jobId }) }
  );
  expect(start.status).toBe(200);

  return { jobId, instanceId };
}

describe("automation-agent routes", () => {
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

  it("registration requires admin bearer", async () => {
    const res = await POST_AUTOMATION_REG(
      new NextRequest("http://localhost/api/automation-agent/registrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_id: "x" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("creates automation-agent registration and rejects duplicates", async () => {
    const { sourceId } = await createSource("automation-reg", db);
    const first = await POST_AUTOMATION_REG(
      new NextRequest("http://localhost/api/automation-agent/registrations", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(first.status).toBe(201);
    expect((await first.json()).automation_agent_id).toBeTruthy();

    const second = await POST_AUTOMATION_REG(
      new NextRequest("http://localhost/api/automation-agent/registrations", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(second.status).toBe(409);
  });

  it("rotates an automation-agent token and revokes the old bearer", async () => {
    const { sourceId } = await createSource("automation-rotate", db);
    const oldToken = await enrollAutomationAgent(sourceId);

    const rotate = await POST_AUTOMATION_ROTATE(
      new NextRequest("http://localhost/api/automation-agent/registrations/rotate", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(rotate.status).toBe(200);
    const rotated = await rotate.json();
    expect(rotated.token).toBeTruthy();
    expect(rotated.token).not.toBe(oldToken);
    expect(rotated.token_prefix).toBe(rotated.token.slice(0, 8));

    const oldRequest = await queueAutomationRequest(oldToken);
    expect(oldRequest.status).toBe(401);

    const newRequest = await queueAutomationRequest(rotated.token);
    expect(newRequest.status).toBe(201);
  });

  it("queues a diagnostic request and replays by idempotency key", async () => {
    const { sourceId } = await createSource("automation-idempotent", db);
    const automationToken = await enrollAutomationAgent(sourceId);

    const first = await queueAutomationRequest(automationToken, {
      request_reason: "collect now",
      idempotency_key: "same-key",
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.source_id).toBe(sourceId);
    expect(firstBody.status).toBe("queued");

    const second = await queueAutomationRequest(automationToken, {
      request_reason: "collect now",
      idempotency_key: "same-key",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.request_id).toBe(firstBody.request_id);

    const stmt = db.prepare("SELECT requested_by FROM collection_jobs WHERE id = ?");
    stmt.bind([firstBody.request_id]);
    expect(stmt.step()).toBe(true);
    const row = stmt.getAsObject() as { requested_by: string };
    expect(row.requested_by).toMatch(/^automation_agent:/);
    stmt.free();
  });

  it("polls queued, claimed, and running states", async () => {
    const { sourceId } = await createSource("automation-pending", db);
    const automationToken = await enrollAutomationAgent(sourceId);
    const executionToken = await enrollExecutionAgent(sourceId);
    await heartbeatExecutionAgent(executionToken);

    const queued = await queueAutomationRequest(automationToken);
    const queuedBody = await queued.json();
    const requestId = queuedBody.request_id as string;

    const queuedPoll = await getAutomationRequest(automationToken, requestId);
    expect(queuedPoll.status).toBe(200);
    expect((await queuedPoll.json()).request.status).toBe("queued");

    const next = await GET_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", {
        headers: executionAuth(executionToken),
      })
    );
    const jobId = (await next.json()).jobs[0].id as string;

    const claim = await POST_CLAIM(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
        method: "POST",
        headers: { ...executionAuth(executionToken), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "pending-1", lease_ttl_seconds: 300 }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(claim.status).toBe(200);

    const claimedPoll = await getAutomationRequest(automationToken, requestId);
    expect((await claimedPoll.json()).request.status).toBe("claimed");

    const start = await POST_START(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
        method: "POST",
        headers: { ...executionAuth(executionToken), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: "pending-1" }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(start.status).toBe(200);

    const runningPoll = await getAutomationRequest(automationToken, requestId);
    const runningBody = await runningPoll.json();
    expect(runningBody.request.status).toBe("running");
    expect(runningBody.result).toBeNull();
  });

  it("returns structured findings after successful submission", async () => {
    const { sourceId } = await createSource("automation-success", db);
    const automationToken = await enrollAutomationAgent(sourceId);
    const executionToken = await enrollExecutionAgent(sourceId);
    await heartbeatExecutionAgent(executionToken);

    const queued = await queueAutomationRequest(automationToken, { request_reason: "run it" });
    const requestId = (await queued.json()).request_id as string;
    const { jobId, instanceId } = await advanceJobToRunning(executionToken);
    expect(jobId).toBe(requestId);

    const form = new FormData();
    form.append("instance_id", instanceId);
    form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "audit.log");
    const artifact = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: executionAuth(executionToken),
        body: form,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(artifact.status).toBe(200);

    const poll = await getAutomationRequest(automationToken, requestId);
    expect(poll.status).toBe(200);
    const body = await poll.json();
    expect(body.request.status).toBe("submitted");
    expect(body.result.run_id).toBeTruthy();
    expect(body.result.artifact_type).toBe("linux-audit-log");
    expect(body.result.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(body.result.top_actions_now)).toBe(true);
    expect(Array.isArray(body.result.findings)).toBe(true);
    expect(body.result.links.run).toBe(`/api/runs/${body.result.run_id}`);
    expect(body.result.links.report).toBe(`/api/runs/${body.result.run_id}/report`);
    expect(body.result.links.compare_api).toBe(`/api/runs/${body.result.run_id}/compare`);
  });

  it("returns terminal analysis-error results when the linked run errored", async () => {
    const errResult: AnalysisResult = {
      report: null,
      environment: {
        hostname: "err-host",
        os: "linux",
        kernel: "k",
        is_wsl: false,
        is_container: false,
        is_virtual_machine: false,
        ran_as_root: false,
        uptime: "1m",
      },
      noise: [],
      pre_findings: [],
      is_incomplete: true,
      incomplete_reason: "analysis failed",
      analysis_error: "forced error",
      meta: {
        model_used: "none",
        tokens_used: 0,
        duration_ms: 0,
        llm_succeeded: false,
      },
    };
    vi.spyOn(analyzer, "analyzeArtifact").mockResolvedValue(errResult);

    const { sourceId } = await createSource("automation-error", db);
    const automationToken = await enrollAutomationAgent(sourceId);
    const executionToken = await enrollExecutionAgent(sourceId);
    await heartbeatExecutionAgent(executionToken);

    const queued = await queueAutomationRequest(automationToken);
    const requestId = (await queued.json()).request_id as string;
    const { jobId, instanceId } = await advanceJobToRunning(executionToken);

    const form = new FormData();
    form.append("instance_id", instanceId);
    form.append("file", new Blob([SAMPLE_LOG], { type: "text/plain" }), "audit.log");
    const artifact = await POST_ARTIFACT(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
        method: "POST",
        headers: executionAuth(executionToken),
        body: form,
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(artifact.status).toBe(200);

    const poll = await getAutomationRequest(automationToken, requestId);
    const body = await poll.json();
    expect(body.request.status).toBe("submitted");
    expect(body.request.result_analysis_status).toBe("error");
    expect(body.result.analysis_error).toBe("forced error");
    expect(body.result.summary).toEqual([]);
    expect(body.result.findings).toEqual([]);
  });

  it("returns terminal failure states with null result", async () => {
    const { sourceId } = await createSource("automation-fail", db);
    const automationToken = await enrollAutomationAgent(sourceId);
    const executionToken = await enrollExecutionAgent(sourceId);
    await heartbeatExecutionAgent(executionToken);

    const queued = await queueAutomationRequest(automationToken);
    const requestId = (await queued.json()).request_id as string;
    const { jobId, instanceId } = await advanceJobToRunning(executionToken);

    const fail = await POST_FAIL(
      new NextRequest(`http://localhost/api/collection-jobs/${jobId}/fail`, {
        method: "POST",
        headers: { ...executionAuth(executionToken), "content-type": "application/json" },
        body: JSON.stringify({
          instance_id: instanceId,
          code: "collector_failed",
          message: "collector failed",
        }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(fail.status).toBe(200);

    const poll = await getAutomationRequest(automationToken, requestId);
    const body = await poll.json();
    expect(body.request.status).toBe("failed");
    expect(body.request.error_code).toBe("collector_failed");
    expect(body.result).toBeNull();
  });

  it("projects expired running leases and blocks cross-source reads", async () => {
    const { sourceId } = await createSource("automation-expired", db);
    const automationToken = await enrollAutomationAgent(sourceId);
    const executionToken = await enrollExecutionAgent(sourceId);
    await heartbeatExecutionAgent(executionToken);

    const other = await createSource("automation-other", db);
    const otherAutomationToken = await enrollAutomationAgent(other.sourceId);

    const queued = await queueAutomationRequest(automationToken);
    const requestId = (await queued.json()).request_id as string;
    const { jobId } = await advanceJobToRunning(executionToken);

    const expired = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE collection_jobs
       SET lease_expires_at = ?
       WHERE id = ?`,
      [expired, jobId]
    );

    const expiredPoll = await getAutomationRequest(automationToken, requestId);
    const expiredBody = await expiredPoll.json();
    expect(expiredBody.request.status).toBe("expired");
    expect(expiredBody.request.error_code).toBe("lease_lost");
    expect(expiredBody.result).toBeNull();

    const forbidden = await getAutomationRequest(otherAutomationToken, requestId);
    expect(forbidden.status).toBe(403);
  });
});
