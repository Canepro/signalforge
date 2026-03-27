import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalysisResult, AuditReport, Finding, Severity } from "@/lib/analyzer/schema";
import { GET as GET_COMPARE } from "@/app/api/runs/[id]/compare/route";
import * as dbClient from "@/lib/db/client";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";
import { insertArtifact, insertRun } from "@/lib/db/repository";

function baseEnv(hostname: string) {
  return {
    hostname,
    os: "Linux",
    kernel: "k",
    is_wsl: false,
    is_container: false,
    is_virtual_machine: false,
    ran_as_root: true,
    uptime: "1d",
  };
}

function mkFinding(id: string, title: string, severity: Severity): Finding {
  return {
    id,
    title,
    severity,
    category: "test",
    section_source: "sec",
    evidence: "ev",
    why_it_matters: "w",
    recommended_action: "r",
  };
}

function mkReport(hostname: string, findings: Finding[]): AuditReport {
  return {
    summary: ["summary line"],
    findings,
    environment_context: baseEnv(hostname),
    noise_or_expected: [],
    top_actions_now: ["a", "b", "c"],
  };
}

function mkResult(report: AuditReport | null): AnalysisResult {
  if (!report) {
    return {
      report: null,
      environment: baseEnv("none"),
      noise: [],
      pre_findings: [],
      is_incomplete: false,
      meta: { model_used: "test", tokens_used: 0, duration_ms: 0, llm_succeeded: false },
    };
  }
  return {
    report,
    environment: report.environment_context,
    noise: [],
    pre_findings: [],
    is_incomplete: false,
    meta: { model_used: "test", tokens_used: 0, duration_ms: 0, llm_succeeded: false },
  };
}

function containerArtifact(fields: Record<string, string>): string {
  const orderedKeys = [
    "hostname",
    "runtime",
    "container_name",
    "image",
    "state_status",
    "health_status",
    "restart_count",
    "oom_killed",
    "exit_code",
    "published_ports",
    "mounts",
    "writable_mounts",
    "read_only_rootfs",
    "added_capabilities",
    "secrets",
    "ran_as_root",
    "memory_limit_bytes",
    "memory_reservation_bytes",
    "cpu_percent",
    "memory_percent",
    "pid_count",
  ];
  return [
    "=== container-diagnostics ===",
    ...orderedKeys
      .filter((key) => key in fields)
      .map((key) => `${key}: ${fields[key]}`),
  ].join("\n");
}

function kubernetesBundleArtifact(input: {
  clusterName: string;
  scopeLevel: "cluster" | "namespace";
  namespace?: string;
  documents?: Array<{
    path: string;
    kind: string;
    media_type: string;
    content: string;
  }>;
}): string {
  return JSON.stringify(
    {
      schema_version: "kubernetes-bundle.v1",
      cluster: { name: input.clusterName, provider: "aks" },
      scope: {
        level: input.scopeLevel,
        namespace: input.scopeLevel === "namespace" ? (input.namespace ?? null) : null,
      },
      documents: input.documents ?? [],
    },
    null,
    2
  );
}

describe("API GET /api/runs/[id]/compare", () => {
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

  it("returns 404 when current run is missing", async () => {
    const res = await GET_COMPARE(
      new NextRequest("http://localhost/api/runs/nope/compare"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when against equals current id", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "x",
    });
    const run = insertRun(db, art.id, mkResult(mkReport("h", [{ ...mkFinding("1", "Only", "low") }])), {
      filename: "a.log",
      source_type: "api",
    });

    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${run.id}/compare?against=${run.id}`),
      { params: Promise.resolve({ id: run.id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/against/i);
  });

  it("returns 404 when explicit against run is missing", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "x",
    });
    const run = insertRun(db, art.id, mkResult(mkReport("h", [{ ...mkFinding("1", "Only", "low") }])), {
      filename: "a.log",
      source_type: "api",
    });

    const res = await GET_COMPARE(
      new NextRequest(
        `http://localhost/api/runs/${run.id}/compare?against=00000000-0000-4000-8000-000000000099`
      ),
      { params: Promise.resolve({ id: run.id }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns baseline_missing true when no prior run for same target", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "solo.log",
      content: "solo",
    });
    const run = insertRun(
      db,
      art.id,
      mkResult(mkReport("solo-host", [{ ...mkFinding("1", "Solo finding", "medium") }])),
      { filename: "solo.log", source_type: "api" }
    );

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${run.id}/compare`), {
      params: Promise.resolve({ id: run.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline_missing).toBe(true);
    expect(body.baseline).toBeNull();
    expect(body.baseline_selection).toBe("none");
    expect(body.target_mismatch).toBe(false);
    expect(body.against_requested).toBeNull();
    expect(body.current.id).toBe(run.id);
    expect(body.current.run_id).toBe(run.id);
    expect(body.current.environment_hostname).toBe("solo-host");
    expect(body.drift.summary).toEqual({
      new: 0,
      resolved: 0,
      severity_up: 0,
      severity_down: 0,
      unchanged: 0,
    });
    expect(body.drift.rows).toEqual([]);
    expect(body.evidence_delta).toBeNull();
  });

  it("uses implicit same-target baseline and reports drift severity", async () => {
    const content = "shared-content";
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content,
    });
    const f1 = mkFinding("f1", "Stable title", "low");
    const older = insertRun(db, art.id, mkResult(mkReport("host-x", [f1])), {
      filename: "older.log",
      source_type: "api",
    });
    const f1b = { ...f1, severity: "high" as Severity };
    const newer = insertRun(db, art.id, mkResult(mkReport("host-x", [f1b])), {
      filename: "newer.log",
      source_type: "api",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      older.id,
    ]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-02-01T00:00:00.000Z",
      newer.id,
    ]);

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline_missing).toBe(false);
    expect(body.baseline_selection).toBe("implicit_same_target");
    expect(body.baseline.id).toBe(older.id);
    expect(body.baseline.run_id).toBe(older.id);
    expect(body.current.run_id).toBe(newer.id);
    expect(body.target_mismatch).toBe(false);
    expect(body.drift.summary.severity_up).toBe(1);
    expect(body.drift.summary.unchanged).toBe(0);
    expect(body.drift.rows).toHaveLength(1);
    expect(body.drift.rows[0].status).toBe("severity_up");
    expect(body.evidence_delta).not.toBeNull();
    expect(body.evidence_delta.summary.artifact_changed).toBe(false);
  });

  it("respects explicit against over implicit baseline", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "trip",
    });
    const f = mkFinding("f1", "Thing", "low");
    const oldest = insertRun(db, art.id, mkResult(mkReport("h", [f])), {
      filename: "oldest.log",
      source_type: "api",
    });
    const middle = insertRun(db, art.id, mkResult(mkReport("h", [{ ...f, severity: "medium" }])), {
      filename: "middle.log",
      source_type: "api",
    });
    const newest = insertRun(db, art.id, mkResult(mkReport("h", [{ ...f, severity: "high" }])), {
      filename: "newest.log",
      source_type: "api",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2020-01-01T00:00:00.000Z", oldest.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2020-02-01T00:00:00.000Z", middle.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2020-03-01T00:00:00.000Z", newest.id]);

    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${newest.id}/compare?against=${oldest.id}`),
      { params: Promise.resolve({ id: newest.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline_selection).toBe("explicit");
    expect(body.baseline.id).toBe(oldest.id);
    expect(body.baseline.run_id).toBe(oldest.id);
    expect(body.against_requested).toBe(oldest.id);
    expect(body.drift.summary.severity_up).toBe(1);
  });

  it("returns evidence_delta when findings are unchanged but metadata or bytes changed", async () => {
    const olderArtifact = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "older.log",
      content: "older-bytes",
    });
    const newerArtifact = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "newer.log",
      content: "newer-bytes",
    });
    const finding = mkFinding("f1", "Stable", "low");
    const older = insertRun(db, olderArtifact.id, mkResult(mkReport("same-host", [finding])), {
      filename: "older.log",
      source_type: "api",
      target_identifier: "fleet:same",
      collector_type: "collector-a",
      collector_version: "1.0.0",
      collected_at: "2026-03-01T00:00:00.000Z",
    });
    const newer = insertRun(db, newerArtifact.id, mkResult(mkReport("same-host", [finding])), {
      filename: "newer.log",
      source_type: "api",
      target_identifier: "fleet:same",
      collector_type: "collector-a",
      collector_version: "1.1.0",
      collected_at: "2026-03-02T00:00:00.000Z",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-01T01:00:00.000Z", older.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-02T01:00:00.000Z", newer.id]);

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drift.rows).toEqual([]);
    expect(body.evidence_delta.changed).toBe(true);
    expect(body.evidence_delta.summary.artifact_changed).toBe(true);
    expect(body.evidence_delta.metadata.collector_version).toBe("changed");
    expect(body.evidence_delta.metadata.collected_at).toBe("changed");
  });

  it("returns container evidence_delta metrics when findings stay the same", async () => {
    const olderArtifact = insertArtifact(db, {
      artifact_type: "container-diagnostics",
      source_type: "api",
      filename: "payments-before.txt",
      content: containerArtifact({
        hostname: "node-a",
        runtime: "docker",
        container_name: "payments",
        image: "registry.example/payments:1.2.3",
        state_status: "running",
        health_status: "healthy",
        restart_count: "0",
        oom_killed: "false",
        published_ports: "8080:80",
        mounts: "/srv/config:/config",
        writable_mounts: "/config",
        read_only_rootfs: "true",
        added_capabilities: "NET_BIND_SERVICE",
        secrets: "db-password",
        ran_as_root: "false",
        memory_limit_bytes: "536870912",
        memory_reservation_bytes: "134217728",
      }),
    });
    const newerArtifact = insertArtifact(db, {
      artifact_type: "container-diagnostics",
      source_type: "api",
      filename: "payments-after.txt",
      content: containerArtifact({
        hostname: "node-a",
        runtime: "docker",
        container_name: "payments",
        image: "registry.example/payments:1.2.4",
        state_status: "restarting",
        health_status: "unhealthy",
        restart_count: "4",
        oom_killed: "true",
        published_ports: "8080:80,8443:443",
        mounts: "/srv/config:/config,/srv/data:/data",
        writable_mounts: "/config,/data",
        read_only_rootfs: "false",
        added_capabilities: "NET_BIND_SERVICE,SYS_PTRACE",
        secrets: "db-password,api-key",
        ran_as_root: "true",
        memory_limit_bytes: "1073741824",
        memory_reservation_bytes: "268435456",
      }),
    });
    const finding = mkFinding("f1", "Stable container finding", "medium");
    const older = insertRun(db, olderArtifact.id, mkResult(mkReport("node-a", [finding])), {
      filename: "payments-before.txt",
      source_type: "api",
      target_identifier: "container:payments",
    });
    const newer = insertRun(db, newerArtifact.id, mkResult(mkReport("node-a", [finding])), {
      filename: "payments-after.txt",
      source_type: "api",
      target_identifier: "container:payments",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-01T01:00:00.000Z", older.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-02T01:00:00.000Z", newer.id]);

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drift.rows).toEqual([]);
    expect(body.evidence_delta.changed).toBe(true);
    expect(body.evidence_delta.summary.artifact_changed).toBe(true);
    expect(body.current.target_display_label).toBe("container:payments");
    expect(body.evidence_delta.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "published_port_count",
          family: "container-diagnostics",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "added_capability_count",
          family: "container-diagnostics",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "secret_mount_count",
          family: "container-diagnostics",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "mount_count",
          family: "container-diagnostics",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "writable_mount_count",
          family: "container-diagnostics",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "runs_as_root",
          family: "container-diagnostics",
          previous: false,
          current: true,
          status: "changed",
        }),
        expect.objectContaining({
          key: "read_only_rootfs",
          family: "container-diagnostics",
          previous: true,
          current: false,
          status: "changed",
        }),
        expect.objectContaining({
          key: "state_status",
          family: "container-diagnostics",
          previous: "running",
          current: "restarting",
          status: "changed",
        }),
        expect.objectContaining({
          key: "health_status",
          family: "container-diagnostics",
          previous: "healthy",
          current: "unhealthy",
          status: "changed",
        }),
        expect.objectContaining({
          key: "restart_count",
          family: "container-diagnostics",
          previous: 0,
          current: 4,
          status: "changed",
        }),
        expect.objectContaining({
          key: "oom_killed",
          family: "container-diagnostics",
          previous: false,
          current: true,
          status: "changed",
        }),
        expect.objectContaining({
          key: "memory_limit_bytes",
          family: "container-diagnostics",
          previous: 536870912,
          current: 1073741824,
          status: "changed",
          unit: "bytes",
        }),
        expect.objectContaining({
          key: "memory_reservation_bytes",
          family: "container-diagnostics",
          previous: 134217728,
          current: 268435456,
          status: "changed",
          unit: "bytes",
        }),
      ])
    );
  });

  it("returns kubernetes evidence_delta metrics when findings stay the same", async () => {
    const olderArtifact = insertArtifact(db, {
      artifact_type: "kubernetes-bundle",
      source_type: "api",
      filename: "payments-before.json",
      content: kubernetesBundleArtifact({
        clusterName: "aks-prod-eu-1",
        scopeLevel: "namespace",
        namespace: "payments",
        documents: [
          {
            path: "network/services.json",
            kind: "service-exposure",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "payments-api",
                type: "LoadBalancer",
                external: true,
              },
            ]),
          },
          {
            path: "rbac/bindings.json",
            kind: "rbac-bindings",
            media_type: "application/json",
            content: JSON.stringify([
              {
                scope: "cluster",
                subject: "system:serviceaccount:payments:payments-api",
                roleRef: "Cluster-Admin",
              },
              {
                scope: "namespace",
                namespace: "payments",
                subject: "system:serviceaccount:payments:payments-api",
                roleRef: "payments-ops",
              },
            ]),
          },
          {
            path: "rbac/roles.json",
            kind: "rbac-roles",
            media_type: "application/json",
            content: JSON.stringify([
              {
                scope: "namespace",
                namespace: "payments",
                name: "payments-ops",
                rules: [
                  {
                    apiGroups: ["*"],
                    resources: ["*"],
                    verbs: ["*"],
                  },
                ],
              },
            ]),
          },
          {
            path: "network/network-policies.json",
            kind: "network-policies",
            media_type: "application/json",
            content: JSON.stringify([]),
          },
          {
            path: "cluster/node-health.json",
            kind: "node-health",
            media_type: "application/json",
            content: JSON.stringify([
              {
                name: "aks-system-000001",
                ready: true,
                unschedulable: false,
                pressure_conditions: [],
              },
            ]),
          },
          {
            path: "events/warning-events.json",
            kind: "warning-events",
            media_type: "application/json",
            content: JSON.stringify([]),
          },
          {
            path: "workloads/rollout-status.json",
            kind: "workload-rollout-status",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "payments-api",
                kind: "Deployment",
                desired_replicas: 2,
                ready_replicas: 2,
                available_replicas: 2,
                updated_replicas: 2,
                unavailable_replicas: 0,
                generation: 4,
                observed_generation: 4,
              },
            ]),
          },
          {
            path: "workloads/specs.json",
            kind: "workload-specs",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "payments-api",
                kind: "Deployment",
                pod_spec: {
                  serviceAccountName: "payments-api",
                  hostNetwork: false,
                  hostPID: false,
                  hostIPC: false,
                  securityContext: {
                        runAsNonRoot: true,
                        readOnlyRootFilesystem: true,
                        seccompProfile: { type: "RuntimeDefault" },
                      },
                      automountServiceAccountToken: false,
                  volumes: [],
                  containers: [
                    {
                      name: "api",
                      env: [],
                      envFrom: [],
                      volumeMounts: [],
                      securityContext: {
                        allowPrivilegeEscalation: false,
                        readOnlyRootFilesystem: true,
                        capabilities: { add: [] },
                      },
                      readinessProbe: { httpGet: { path: "/ready", port: 8080 } },
                      livenessProbe: { httpGet: { path: "/live", port: 8080 } },
                      resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "500m", memory: "256Mi" },
                      },
                    },
                  ],
                  initContainers: [],
                },
              },
            ]),
          },
        ],
      }),
    });
    const newerArtifact = insertArtifact(db, {
      artifact_type: "kubernetes-bundle",
      source_type: "api",
      filename: "payments-after.json",
      content: kubernetesBundleArtifact({
        clusterName: "aks-prod-eu-1",
        scopeLevel: "namespace",
        namespace: "payments",
        documents: [
          {
            path: "network/services.json",
            kind: "service-exposure",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "payments-api",
                type: "LoadBalancer",
                external: true,
              },
              {
                namespace: "payments",
                name: "payments-metrics",
                type: "NodePort",
                external: false,
              },
            ]),
          },
          {
            path: "rbac/bindings.json",
            kind: "rbac-bindings",
            media_type: "application/json",
            content: JSON.stringify([
              {
                scope: "cluster",
                subject: "system:serviceaccount:payments:payments-api",
                roleRef: "Cluster-Admin",
              },
              {
                scope: "cluster",
                subject: "system:serviceaccount:payments:payments-jobs",
                roleRef: "cluster-admin",
              },
              {
                scope: "namespace",
                namespace: "payments",
                subject: "system:serviceaccount:payments:default",
                roleRef: "payments-ops",
              },
              {
                scope: "namespace",
                namespace: "payments",
                subject: "system:serviceaccount:payments:default",
                roleRef: "payments-automation",
              },
              {
                scope: "cluster",
                subject: "system:serviceaccount:payments:default",
                roleRef: "payments-breakglass",
              },
            ]),
          },
          {
            path: "rbac/roles.json",
            kind: "rbac-roles",
            media_type: "application/json",
            content: JSON.stringify([
              {
                scope: "namespace",
                namespace: "payments",
                name: "payments-ops",
                rules: [
                  {
                    apiGroups: ["*"],
                    resources: ["*"],
                    verbs: ["*"],
                  },
                ],
              },
              {
                scope: "namespace",
                namespace: "payments",
                name: "payments-automation",
                rules: [
                  {
                    apiGroups: ["*"],
                    resources: ["*"],
                    verbs: ["get", "list", "*"],
                  },
                ],
              },
              {
                scope: "cluster",
                name: "payments-breakglass",
                rules: [
                  {
                    apiGroups: ["rbac.authorization.k8s.io"],
                    resources: ["clusterroles"],
                    verbs: ["bind", "escalate", "impersonate"],
                  },
                  {
                    apiGroups: [""],
                    resources: ["nodes/proxy"],
                    verbs: ["get"],
                  },
                ],
              },
            ]),
          },
          {
            path: "network/network-policies.json",
            kind: "network-policies",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "default-deny",
              },
            ]),
          },
          {
            path: "cluster/node-health.json",
            kind: "node-health",
            media_type: "application/json",
            content: JSON.stringify([
              {
                name: "aks-system-000001",
                ready: false,
                unschedulable: false,
                pressure_conditions: ["MemoryPressure"],
              },
              {
                name: "aks-user-000002",
                ready: true,
                unschedulable: false,
                pressure_conditions: [],
              },
            ]),
          },
          {
            path: "events/warning-events.json",
            kind: "warning-events",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                involved_kind: "Pod",
                involved_name: "payments-api-abc123",
                reason: "FailedScheduling",
                message: "0/3 nodes are available: 3 Insufficient memory.",
                count: 4,
                last_timestamp: "2026-03-26T10:00:00Z",
              },
              {
                namespace: "payments",
                involved_kind: "Pod",
                involved_name: "payments-api-abc123",
                reason: "ImagePullBackOff",
                message: "Back-off pulling image ghcr.io/acme/payments:bad",
                count: 2,
                last_timestamp: "2026-03-26T10:05:00Z",
              },
            ]),
          },
          {
            path: "workloads/rollout-status.json",
            kind: "workload-rollout-status",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "payments-api",
                kind: "Deployment",
                desired_replicas: 3,
                ready_replicas: 1,
                available_replicas: 1,
                updated_replicas: 2,
                unavailable_replicas: 2,
                generation: 5,
                observed_generation: 4,
              },
            ]),
          },
          {
            path: "workloads/specs.json",
            kind: "workload-specs",
            media_type: "application/json",
            content: JSON.stringify([
              {
                namespace: "payments",
                name: "payments-api",
                kind: "Deployment",
                pod_spec: {
                  serviceAccountName: "default",
                  automountServiceAccountToken: true,
                  hostNetwork: true,
                  hostPID: true,
                  hostIPC: true,
                  volumes: [
                    {
                      name: "payments-api-secrets-volume",
                      secret: { secretName: "payments-api-secrets" },
                    },
                    {
                      name: "payments-host-data",
                      hostPath: { path: "/var/lib/payments-data" },
                    },
                    {
                      name: "payments-token",
                      projected: {
                        sources: [
                          {
                            serviceAccountToken: {
                              audience: "payments-api",
                              expirationSeconds: 3600,
                              path: "token",
                            },
                          },
                        ],
                      },
                    },
                  ],
                  containers: [
                    {
                      name: "api",
                      env: [
                        {
                          name: "DATABASE_URL",
                          valueFrom: {
                            secretKeyRef: { name: "payments-api-secrets", key: "database_url" },
                          },
                        },
                        {
                          name: "PAYMENTS_API_KEY",
                          valueFrom: {
                            secretKeyRef: { name: "payments-api-secrets", key: "api_key" },
                          },
                        },
                      ],
                      envFrom: [
                        {
                          secretRef: { name: "payments-api-env" },
                        },
                      ],
                      volumeMounts: [
                        {
                          name: "payments-api-secrets-volume",
                          mountPath: "/var/run/secrets/payments",
                          readOnly: true,
                        },
                        {
                          name: "payments-host-data",
                          mountPath: "/host/payments-data",
                        },
                        {
                          name: "payments-token",
                          mountPath: "/var/run/secrets/tokens",
                          readOnly: true,
                        },
                      ],
                      securityContext: {
                        privileged: true,
                        allowPrivilegeEscalation: true,
                        runAsNonRoot: false,
                        readOnlyRootFilesystem: false,
                        capabilities: { add: ["NET_ADMIN"] },
                        seccompProfile: { type: "Unconfined" },
                      },
                      readinessProbe: null,
                      livenessProbe: null,
                      resources: {},
                    },
                  ],
                  initContainers: [
                    {
                      name: "bootstrap",
                      securityContext: { privileged: true },
                    },
                  ],
                },
              },
            ]),
          },
        ],
      }),
    });
    const finding = mkFinding("f1", "Stable Kubernetes finding", "medium");
    const older = insertRun(db, olderArtifact.id, mkResult(mkReport("aks-prod-eu-1", [finding])), {
      filename: "payments-before.json",
      source_type: "api",
      target_identifier: "cluster:aks-prod-eu-1:namespace:payments",
    });
    const newer = insertRun(db, newerArtifact.id, mkResult(mkReport("aks-prod-eu-1", [finding])), {
      filename: "payments-after.json",
      source_type: "api",
      target_identifier: "cluster:aks-prod-eu-1:namespace:payments",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-01T01:00:00.000Z", older.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-02T01:00:00.000Z", newer.id]);

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drift.rows).toEqual([]);
    expect(body.evidence_delta.changed).toBe(true);
    expect(body.evidence_delta.summary.artifact_changed).toBe(true);
    expect(body.current.target_display_label).toBe("cluster:aks-prod-eu-1:namespace:payments");
    expect(body.evidence_delta.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "warning_event_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 6,
          status: "changed",
        }),
        expect.objectContaining({
          key: "node_not_ready_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "node_pressure_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "rollout_issue_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "unavailable_replica_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "external_service_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "cluster_admin_binding_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "workload_cluster_admin_binding_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 0,
          status: "changed",
        }),
        expect.objectContaining({
          key: "workload_rbac_wildcard_binding_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "workload_rbac_privilege_escalation_binding_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "workload_rbac_node_proxy_binding_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "externally_exposed_workload_cluster_admin_binding_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 0,
          status: "changed",
        }),
        expect.objectContaining({
          key: "externally_exposed_workload_rbac_wildcard_binding_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "externally_exposed_workload_rbac_privilege_escalation_binding_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "externally_exposed_workload_rbac_node_proxy_binding_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "externally_exposed_default_service_account_automount_workload_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "externally_exposed_projected_service_account_token_volume_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "network_policy_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "exposed_namespace_without_network_policy_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 0,
          status: "changed",
        }),
        expect.objectContaining({
          key: "workload_hardening_gap_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 14,
          status: "changed",
        }),
        expect.objectContaining({
          key: "rbac_wildcard_role_count",
          family: "kubernetes-bundle",
          previous: 1,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "rbac_privilege_escalation_role_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "rbac_node_proxy_access_role_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "service_account_token_automount_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "writable_root_filesystem_workload_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "default_service_account_automount_workload_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "secret_env_reference_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 2,
          status: "changed",
        }),
        expect.objectContaining({
          key: "secret_env_from_reference_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "secret_volume_mount_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "projected_service_account_token_volume_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "host_network_workload_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "host_pid_workload_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "host_ipc_workload_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "host_path_volume_mount_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "added_capability_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
        expect.objectContaining({
          key: "privileged_init_container_count",
          family: "kubernetes-bundle",
          previous: 0,
          current: 1,
          status: "changed",
        }),
      ])
    );
  });

  it("matches implicit baseline by target_identifier across hostnames", async () => {
    const a1 = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a1.log",
      content: "c1",
    });
    const a2 = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a2.log",
      content: "c2",
    });
    const f = mkFinding("f1", "X", "low");
    const older = insertRun(db, a1.id, mkResult(mkReport("host-a", [f])), {
      filename: "a1.log",
      source_type: "api",
      target_identifier: "fleet:shared",
    });
    const newer = insertRun(db, a2.id, mkResult(mkReport("host-b", [f])), {
      filename: "a2.log",
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

    const res = await GET_COMPARE(new NextRequest(`http://localhost/api/runs/${newer.id}/compare`), {
      params: Promise.resolve({ id: newer.id }),
    });
    const body = await res.json();
    expect(body.baseline.id).toBe(older.id);
    expect(body.baseline.run_id).toBe(older.id);
    expect(body.target_mismatch).toBe(false);
    expect(body.current.environment_hostname).not.toBe(body.baseline.environment_hostname);
  });

  it("matches implicit baseline by container identity before hostname-only fallback", async () => {
    const artifactA = insertArtifact(db, {
      artifact_type: "container-diagnostics",
      source_type: "api",
      filename: "payments-old.txt",
      content: containerArtifact({
        hostname: "node-a",
        runtime: "docker",
        container_name: "payments",
        image: "registry.example/payments:1.2.3",
      }),
    });
    const artifactB = insertArtifact(db, {
      artifact_type: "container-diagnostics",
      source_type: "api",
      filename: "search.txt",
      content: containerArtifact({
        hostname: "node-a",
        runtime: "docker",
        container_name: "search",
        image: "registry.example/search:3.4.5",
      }),
    });
    const artifactC = insertArtifact(db, {
      artifact_type: "container-diagnostics",
      source_type: "api",
      filename: "payments-new.txt",
      content: containerArtifact({
        hostname: "node-a",
        runtime: "docker",
        container_name: "payments",
        image: "registry.example/payments:1.2.4",
      }),
    });
    const finding = mkFinding("f1", "Stable container finding", "medium");
    const olderPayments = insertRun(db, artifactA.id, mkResult(mkReport("node-a", [finding])), {
      filename: "payments-old.txt",
      source_type: "api",
    });
    const newerSearch = insertRun(db, artifactB.id, mkResult(mkReport("node-a", [finding])), {
      filename: "search.txt",
      source_type: "api",
    });
    const currentPayments = insertRun(db, artifactC.id, mkResult(mkReport("node-a", [finding])), {
      filename: "payments-new.txt",
      source_type: "api",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-01T01:00:00.000Z", olderPayments.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-02T01:00:00.000Z", newerSearch.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-03T01:00:00.000Z", currentPayments.id]);

    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${currentPayments.id}/compare`),
      { params: Promise.resolve({ id: currentPayments.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline.id).toBe(olderPayments.id);
    expect(body.baseline.id).not.toBe(newerSearch.id);
    expect(body.current.target_display_label).toBe("payments @ node-a");
  });

  it("sets target_mismatch when explicit baseline has different target identity (same hostname)", async () => {
    const art = insertArtifact(db, {
      artifact_type: "linux-audit-log",
      source_type: "api",
      filename: "a.log",
      content: "same",
    });
    const f = mkFinding("f1", "X", "low");
    const older = insertRun(db, art.id, mkResult(mkReport("samehost", [f])), {
      filename: "v1.log",
      source_type: "api",
      target_identifier: "tid-b",
    });
    const newer = insertRun(db, art.id, mkResult(mkReport("samehost", [f])), {
      filename: "v2.log",
      source_type: "api",
      target_identifier: "tid-a",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      older.id,
    ]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", [
      "2020-02-01T00:00:00.000Z",
      newer.id,
    ]);

    // Implicit baseline would be null (tid-a does not match tid-b); explicit `against` selects the row.
    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${newer.id}/compare?against=${older.id}`),
      { params: Promise.resolve({ id: newer.id }) }
    );
    const body = await res.json();
    expect(body.baseline.id).toBe(older.id);
    expect(body.baseline.run_id).toBe(older.id);
    expect(body.baseline_selection).toBe("explicit");
    expect(body.target_mismatch).toBe(true);
  });

  it("matches implicit baseline by Kubernetes cluster scope before hostname-only fallback", async () => {
    const artifactA = insertArtifact(db, {
      artifact_type: "kubernetes-bundle",
      source_type: "api",
      filename: "payments-old.json",
      content: kubernetesBundleArtifact({
        clusterName: "aks-prod-eu-1",
        scopeLevel: "namespace",
        namespace: "payments",
      }),
    });
    const artifactB = insertArtifact(db, {
      artifact_type: "kubernetes-bundle",
      source_type: "api",
      filename: "checkout.json",
      content: kubernetesBundleArtifact({
        clusterName: "aks-prod-eu-1",
        scopeLevel: "namespace",
        namespace: "checkout",
      }),
    });
    const artifactC = insertArtifact(db, {
      artifact_type: "kubernetes-bundle",
      source_type: "api",
      filename: "payments-new.json",
      content: kubernetesBundleArtifact({
        clusterName: "aks-prod-eu-1",
        scopeLevel: "namespace",
        namespace: "payments",
      }),
    });
    const finding = mkFinding("f1", "Stable Kubernetes finding", "medium");
    const olderPayments = insertRun(db, artifactA.id, mkResult(mkReport("aks-prod-eu-1", [finding])), {
      filename: "payments-old.json",
      source_type: "api",
    });
    const newerCheckout = insertRun(db, artifactB.id, mkResult(mkReport("aks-prod-eu-1", [finding])), {
      filename: "checkout.json",
      source_type: "api",
    });
    const currentPayments = insertRun(db, artifactC.id, mkResult(mkReport("aks-prod-eu-1", [finding])), {
      filename: "payments-new.json",
      source_type: "api",
    });
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-01T01:00:00.000Z", olderPayments.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-02T01:00:00.000Z", newerCheckout.id]);
    db.run("UPDATE runs SET created_at = ? WHERE id = ?", ["2026-03-03T01:00:00.000Z", currentPayments.id]);

    const res = await GET_COMPARE(
      new NextRequest(`http://localhost/api/runs/${currentPayments.id}/compare`),
      { params: Promise.resolve({ id: currentPayments.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline.id).toBe(olderPayments.id);
    expect(body.baseline.id).not.toBe(newerCheckout.id);
    expect(body.current.target_display_label).toBe("aks-prod-eu-1 / namespace payments");
  });
});
