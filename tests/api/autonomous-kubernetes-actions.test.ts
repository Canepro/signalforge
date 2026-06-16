import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Database } from "sql.js";
import type { AnalysisResult } from "@/lib/analyzer/schema";
import { POLICY_DISABLE_SERVICE_ACCOUNT_TOKEN_AUTOMOUNT } from "@/lib/automation/fix-policy";
import { getTestDb } from "@/lib/db/client";
import * as dbClient from "@/lib/db/client";
import * as analyzer from "@/lib/analyzer/index";
import { POST as POST_SOURCES } from "@/app/api/sources/route";
import {
  GET as GET_SOURCE_JOBS,
  POST as POST_SOURCE_JOBS,
} from "@/app/api/sources/[id]/collection-jobs/route";
import { POST as POST_AGENT_REG } from "@/app/api/agent/registrations/route";
import { POST as POST_AUTOMATION_REG } from "@/app/api/automation-agent/registrations/route";
import { POST as POST_HEARTBEAT } from "@/app/api/agent/heartbeat/route";
import { GET as GET_JOB_NEXT } from "@/app/api/agent/jobs/next/route";
import { POST as POST_JOB_CLAIM } from "@/app/api/collection-jobs/[id]/claim/route";
import { POST as POST_JOB_START } from "@/app/api/collection-jobs/[id]/start/route";
import { POST as POST_JOB_ARTIFACT } from "@/app/api/collection-jobs/[id]/artifact/route";
import { GET as GET_SIGNAL_NEXT } from "@/app/api/automation-agent/signals/next/route";
import { POST as POST_AUTOMATION_REQUEST } from "@/app/api/automation-agent/diagnostic-requests/route";
import { POST as POST_FIX_ACTION } from "@/app/api/automation-agent/fix-action-runs/route";
import { GET as GET_FIX_NEXT } from "@/app/api/agent/fix-actions/next/route";
import { POST as POST_FIX_CLAIM } from "@/app/api/fix-action-runs/[id]/claim/route";
import { POST as POST_FIX_START } from "@/app/api/fix-action-runs/[id]/start/route";
import { POST as POST_FIX_DRY_RUN } from "@/app/api/fix-action-runs/[id]/dry-run/route";
import { POST as POST_FIX_APPLY } from "@/app/api/fix-action-runs/[id]/apply/route";

const ADMIN = "admin-autonomous-kube";
const adminAuth = { authorization: `Bearer ${ADMIN}` };
const agentAuth = (token: string) => ({ authorization: `Bearer ${token}` });
const automationAuth = (token: string) => ({ authorization: `Bearer ${token}` });

const kubeResult = (findings = true): AnalysisResult => ({
  report: {
    summary: ["kubernetes workload review"],
    findings: findings ?
      [
        {
          id: "KUBE_TOKEN_AUTOMOUNT",
          title: "Workload automatically mounts service account tokens",
          severity: "high",
          category: "identity",
          section_source: "workloads",
          evidence: JSON.stringify({
            namespace: "payments",
            name: "payments-api",
            kind: "Deployment",
            pod_spec: { automountServiceAccountToken: true },
          }),
          why_it_matters: "Mounted API tokens increase credential exposure.",
          recommended_action: "Set automountServiceAccountToken to false.",
        },
      ]
    : [],
    environment_context: {
      hostname: "payments-cluster",
      os: "kubernetes",
      kernel: "n/a",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: false,
      uptime: "n/a",
    },
    noise_or_expected: [],
    top_actions_now: ["Disable token automount where API access is not required."],
  },
  environment: {
    hostname: "payments-cluster",
    os: "kubernetes",
    kernel: "n/a",
    is_wsl: false,
    is_container: false,
    is_virtual_machine: false,
    ran_as_root: false,
    uptime: "n/a",
  },
  noise: [],
  pre_findings: [],
  is_incomplete: false,
  incomplete_reason: undefined,
  analysis_error: undefined,
  meta: {
    model_used: "deterministic-test",
    tokens_used: 0,
    duration_ms: 1,
    llm_succeeded: false,
  },
});

async function createKubeSource() {
  process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
  const res = await POST_SOURCES(
    new NextRequest("http://localhost/api/sources", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Payments cluster",
        target_identifier: "cluster:payments",
        source_type: "linux_host",
        expected_artifact_type: "kubernetes-bundle",
        capabilities: ["collect:kubernetes-bundle", "fix:kubernetes-safe"],
        automation_enabled: true,
        auto_fix_enabled: true,
        allowed_fix_policy_ids: [POLICY_DISABLE_SERVICE_ACCOUNT_TOKEN_AUTOMOUNT],
        default_collection_scope: { kind: "kubernetes_scope", scope_level: "namespace", namespace: "payments" },
      }),
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.id as string;
}

async function createContainerSource() {
  process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
  const res = await POST_SOURCES(
    new NextRequest("http://localhost/api/sources", {
      method: "POST",
      headers: { ...adminAuth, "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Mac Podman container host",
        target_identifier: "container-host:canepro-mac-podman",
        source_type: "linux_host",
        expected_artifact_type: "container-diagnostics",
        capabilities: ["collect:container-diagnostics"],
        automation_enabled: true,
      }),
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.id as string;
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
  return (await res.json()).token as string;
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
  return (await res.json()).token as string;
}

async function heartbeat(token: string) {
  const res = await POST_HEARTBEAT(
    new NextRequest("http://localhost/api/agent/heartbeat", {
      method: "POST",
      headers: { ...agentAuth(token), "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: ["collect:kubernetes-bundle", "fix:kubernetes-safe"],
        attributes: {},
        agent_version: "test",
        active_job_id: null,
      }),
    })
  );
  expect(res.status).toBe(200);
}

async function queueAndSubmitKubeJob(sourceId: string, agentToken: string, result: AnalysisResult) {
  vi.spyOn(analyzer, "analyzeArtifact").mockResolvedValueOnce(result);
  const queued = await POST_SOURCE_JOBS(
    new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
      method: "POST",
      headers: adminAuth,
    }),
    { params: Promise.resolve({ id: sourceId }) }
  );
  expect(queued.status).toBe(201);
  const queuedBody = await queued.json();
  return submitQueuedJob(agentToken, queuedBody.id as string);
}

async function submitQueuedJob(agentToken: string, jobId: string) {
  const instanceId = `instance-${jobId}`;
  const claim = await POST_JOB_CLAIM(
    new NextRequest(`http://localhost/api/collection-jobs/${jobId}/claim`, {
      method: "POST",
      headers: { ...agentAuth(agentToken), "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId }),
    }),
    { params: Promise.resolve({ id: jobId }) }
  );
  expect(claim.status).toBe(200);
  const start = await POST_JOB_START(
    new NextRequest(`http://localhost/api/collection-jobs/${jobId}/start`, {
      method: "POST",
      headers: { ...agentAuth(agentToken), "content-type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId }),
    }),
    { params: Promise.resolve({ id: jobId }) }
  );
  expect(start.status).toBe(200);
  const form = new FormData();
  form.append("instance_id", instanceId);
  form.append("artifact_type", "kubernetes-bundle");
  form.append("file", new Blob(["{}"], { type: "application/json" }), "bundle.json");
  const artifact = await POST_JOB_ARTIFACT(
    new NextRequest(`http://localhost/api/collection-jobs/${jobId}/artifact`, {
      method: "POST",
      headers: agentAuth(agentToken),
      body: form,
    }),
    { params: Promise.resolve({ id: jobId }) }
  );
  expect(artifact.status).toBe(200);
  return artifact.json();
}

describe("autonomous Kubernetes actions", () => {
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

  it("queues automation-agent diagnostics with explicit container collection scope", async () => {
    const sourceId = await createContainerSource();
    const automationToken = await enrollAutomationAgent(sourceId);

    const diagnostic = await POST_AUTOMATION_REQUEST(
      new NextRequest("http://localhost/api/automation-agent/diagnostic-requests", {
        method: "POST",
        headers: { ...automationAuth(automationToken), "content-type": "application/json" },
        body: JSON.stringify({
          request_reason: "check Mac Podman container hygiene",
          collection_scope: {
            kind: "container_target",
            runtime: "podman",
            container_ref: "signalforge-pg",
            host_hint: "canepro-mac",
          },
        }),
      })
    );
    expect(diagnostic.status).toBe(201);

    const jobs = await GET_SOURCE_JOBS(
      new NextRequest(`http://localhost/api/sources/${sourceId}/collection-jobs`, {
        headers: adminAuth,
      }),
      { params: Promise.resolve({ id: sourceId }) }
    );
    expect(jobs.status).toBe(200);
    const body = await jobs.json();
    expect(body.jobs[0].collection_scope).toMatchObject({
      kind: "container_target",
      runtime: "podman",
      container_ref: "signalforge-pg",
      host_hint: "canepro-mac",
    });
  });

  it("rejects automation-agent diagnostics with collection scope for the wrong artifact family", async () => {
    const sourceId = await createContainerSource();
    const automationToken = await enrollAutomationAgent(sourceId);

    const diagnostic = await POST_AUTOMATION_REQUEST(
      new NextRequest("http://localhost/api/automation-agent/diagnostic-requests", {
        method: "POST",
        headers: { ...automationAuth(automationToken), "content-type": "application/json" },
        body: JSON.stringify({
          request_reason: "bad scope",
          collection_scope: { kind: "linux_host" },
        }),
      })
    );
    expect(diagnostic.status).toBe(400);
    expect((await diagnostic.json()).code).toBe("invalid_collection_scope");
  });

  it("derives a signal, triggers diagnostics, queues a safe fix, records execution, and verifies post-fix evidence", async () => {
    const sourceId = await createKubeSource();
    const agentToken = await enrollExecutionAgent(sourceId);
    const automationToken = await enrollAutomationAgent(sourceId);
    await heartbeat(agentToken);

    await queueAndSubmitKubeJob(sourceId, agentToken, kubeResult(true));

    const signals = await GET_SIGNAL_NEXT(
      new NextRequest("http://localhost/api/automation-agent/signals/next", {
        headers: automationAuth(automationToken),
      })
    );
    expect(signals.status).toBe(200);
    const signal = (await signals.json()).signals[0];
    expect(signal.finding_id).toBe("KUBE_TOKEN_AUTOMOUNT");

    const diagnostic = await POST_AUTOMATION_REQUEST(
      new NextRequest("http://localhost/api/automation-agent/diagnostic-requests", {
        method: "POST",
        headers: { ...automationAuth(automationToken), "content-type": "application/json" },
        body: JSON.stringify({ trigger_signal_id: signal.id, request_reason: "confirm before fix" }),
      })
    );
    expect(diagnostic.status).toBe(201);
    const diagnosticJobId = (await diagnostic.json()).request_id as string;

    const nextJob = await GET_JOB_NEXT(
      new NextRequest("http://localhost/api/agent/jobs/next", { headers: agentAuth(agentToken) })
    );
    expect((await nextJob.json()).jobs[0].id).toBe(diagnosticJobId);
    vi.spyOn(analyzer, "analyzeArtifact").mockResolvedValueOnce(kubeResult(true));
    const diagnosticSubmit = await submitQueuedJob(agentToken, diagnosticJobId);
    const preFixRunId = diagnosticSubmit.run_id as string;

    const action = await POST_FIX_ACTION(
      new NextRequest("http://localhost/api/automation-agent/fix-action-runs", {
        method: "POST",
        headers: { ...automationAuth(automationToken), "content-type": "application/json" },
        body: JSON.stringify({
          signal_id: signal.id,
          diagnostic_request_id: diagnosticJobId,
          pre_fix_run_id: preFixRunId,
          idempotency_key: "same-action",
        }),
      })
    );
    expect(action.status).toBe(201);
    const actionBody = await action.json();
    expect(actionBody.policy_id).toBe(POLICY_DISABLE_SERVICE_ACCOUNT_TOKEN_AUTOMOUNT);

    const nextAction = await GET_FIX_NEXT(
      new NextRequest("http://localhost/api/agent/fix-actions/next", { headers: agentAuth(agentToken) })
    );
    const nextActionBody = await nextAction.json();
    expect(nextActionBody.actions[0].id).toBe(actionBody.action_run_id);
    expect(nextActionBody.actions[0].action_payload).toMatchObject({
      policy_id: POLICY_DISABLE_SERVICE_ACCOUNT_TOKEN_AUTOMOUNT,
      target: {
        kind: "Deployment",
        namespace: "payments",
        name: "payments-api",
        resource: "deployment/payments-api",
      },
      changed_fields: ["spec.template.spec.automountServiceAccountToken"],
    });

    const instanceId = "fix-instance-1";
    const claim = await POST_FIX_CLAIM(
      new NextRequest(`http://localhost/api/fix-action-runs/${actionBody.action_run_id}/claim`, {
        method: "POST",
        headers: { ...agentAuth(agentToken), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: instanceId }),
      }),
      { params: Promise.resolve({ id: actionBody.action_run_id }) }
    );
    expect(claim.status).toBe(200);

    const start = await POST_FIX_START(
      new NextRequest(`http://localhost/api/fix-action-runs/${actionBody.action_run_id}/start`, {
        method: "POST",
        headers: { ...agentAuth(agentToken), "content-type": "application/json" },
        body: JSON.stringify({ instance_id: instanceId }),
      }),
      { params: Promise.resolve({ id: actionBody.action_run_id }) }
    );
    expect(start.status).toBe(200);

    const dryRun = await POST_FIX_DRY_RUN(
      new NextRequest(`http://localhost/api/fix-action-runs/${actionBody.action_run_id}/dry-run`, {
        method: "POST",
        headers: { ...agentAuth(agentToken), "content-type": "application/json" },
        body: JSON.stringify({
          instance_id: instanceId,
          status: "passed",
          summary: { resource: "deployment/payments-api" },
        }),
      }),
      { params: Promise.resolve({ id: actionBody.action_run_id }) }
    );
    expect(dryRun.status).toBe(200);
    expect((await dryRun.json()).status).toBe("applying");

    const apply = await POST_FIX_APPLY(
      new NextRequest(`http://localhost/api/fix-action-runs/${actionBody.action_run_id}/apply`, {
        method: "POST",
        headers: { ...agentAuth(agentToken), "content-type": "application/json" },
        body: JSON.stringify({
          instance_id: instanceId,
          status: "applied",
          summary: { server_side_apply: true },
        }),
      }),
      { params: Promise.resolve({ id: actionBody.action_run_id }) }
    );
    expect(apply.status).toBe(200);
    const postFixJobId = (await apply.json()).post_fix_job.id as string;

    vi.spyOn(analyzer, "analyzeArtifact").mockResolvedValueOnce(kubeResult(false));
    await submitQueuedJob(agentToken, postFixJobId);

    const row = db.exec("SELECT status, post_fix_run_id FROM fix_action_runs")[0].values[0];
    expect(row[0]).toBe("verified");
    expect(row[1]).toBeTruthy();
    const signalRow = db.exec("SELECT status FROM automation_signals WHERE id = '" + signal.id + "'")[0].values[0];
    expect(signalRow[0]).toBe("resolved");
  });
});
