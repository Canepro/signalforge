import { describe, expect, it } from "vitest";
import type { Finding, Severity } from "@/lib/analyzer/schema";
import type { RunDetail } from "@/types/api";
import { buildRunDetailSummaryModules } from "@/lib/run-detail-summary";

function mkFinding(
  id: string,
  title: string,
  severity: Severity,
  extra?: Partial<Finding>
): Finding {
  return {
    id,
    title,
    severity,
    category: extra?.category ?? "runtime",
    section_source: extra?.section_source ?? "test",
    evidence: extra?.evidence ?? "evidence",
    why_it_matters: extra?.why_it_matters ?? "why it matters",
    recommended_action: extra?.recommended_action ?? "recommended action",
  };
}

function mkRun(overrides?: Partial<RunDetail>): RunDetail {
  return {
    id: "run-1",
    artifact_id: "artifact-1",
    parent_run_id: null,
    filename: "sample.txt",
    artifact_type: "linux-audit-log",
    source_type: "agent",
    target_identifier: "target-1",
    source_label: "source-1",
    collector_type: "signalforge-collectors",
    collector_version: "1.0.0",
    collected_at: "2026-03-30T20:08:30.447Z",
    collected_at_label: "Mar 30, 08:08 PM",
    created_at: "2026-03-30T20:09:37.852Z",
    created_at_label: "Mar 30, 08:09 PM",
    status: "complete",
    is_incomplete: false,
    incomplete_reason: null,
    analysis_error: null,
    model_used: "deterministic-only",
    tokens_used: 0,
    duration_ms: 1200,
    severity_counts: { critical: 0, high: 1, medium: 2, low: 0 },
    report: {
      summary: ["Summary"],
      findings: [],
      environment_context: {
        hostname: "host-1",
        os: "Linux",
        kernel: "6.8",
        is_wsl: false,
        is_container: false,
        is_virtual_machine: false,
        ran_as_root: false,
        uptime: "1 day",
      },
      noise_or_expected: [],
      top_actions_now: ["Action one", "Action two", "Action three"],
    },
    environment: {
      hostname: "host-1",
      os: "Linux",
      kernel: "6.8",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: false,
      uptime: "1 day",
    },
    noise: [],
    pre_findings: [],
    summary_modules: null,
    ...overrides,
  };
}

describe("run-detail-summary", () => {
  it("builds Kubernetes modules from raw bundle content", () => {
    const run = mkRun({
      artifact_type: "kubernetes-bundle",
      report: {
        summary: ["Summary"],
        findings: [
          mkFinding("1", "Kubernetes warning events indicate scheduling failures (1 events)", "high", {
            section_source: "events/warning-events.json",
            category: "kubernetes",
            evidence: JSON.stringify({
              warning_event_count: 1,
              namespaces: ["signalforge"],
              affected_objects: ["Pod/signalforge-agent"],
            }),
          }),
        ],
        environment_context: {
          hostname: "oke-cluster",
          os: "Kubernetes (oke)",
          kernel: "k8s",
          is_wsl: false,
          is_container: false,
          is_virtual_machine: false,
          ran_as_root: false,
          uptime: "unknown",
        },
        noise_or_expected: [],
        top_actions_now: ["Scale cluster capacity", "Inspect top memory consumers", "Review quota and HPA coverage"],
      },
      severity_counts: { critical: 0, high: 2, medium: 1, low: 0 },
    });

    const bundle = JSON.stringify({
      schema_version: "kubernetes-bundle.v1",
      cluster: { name: "oke-cluster", provider: "oke" },
      scope: { level: "cluster" },
      collected_at: "2026-03-30T20:08:30.447Z",
      collector: { type: "signalforge-collectors", version: "1.1.0" },
      documents: [
        {
          path: "cluster/node-health.json",
          kind: "node-health",
          media_type: "application/json",
          content: JSON.stringify([
            { name: "10.0.2.147", ready: true, unschedulable: false, pressure_conditions: [] },
            { name: "10.0.2.62", ready: true, unschedulable: false, pressure_conditions: [] },
          ]),
        },
        {
          path: "metrics/node-top.json",
          kind: "node-top",
          media_type: "application/json",
          content: JSON.stringify([
            { name: "10.0.2.147", cpu: "628m", cpu_percent: 34, memory: "8066Mi", memory_percent: 85 },
            { name: "10.0.2.62", cpu: "605m", cpu_percent: 33, memory: "6939Mi", memory_percent: 73 },
          ]),
        },
        {
          path: "metrics/pod-top.json",
          kind: "pod-top",
          media_type: "application/json",
          content: JSON.stringify([
            { namespace: "jenkins", name: "jenkins-0", cpu: "3m", memory: "1777Mi" },
            { namespace: "monitoring", name: "tempo-0", cpu: "5m", memory: "827Mi" },
            { namespace: "argocd", name: "argocd-application-controller-0", cpu: "94m", memory: "505Mi" },
          ]),
        },
        {
          path: "events/warning-events.json",
          kind: "warning-events",
          media_type: "application/json",
          content: JSON.stringify([
            {
              namespace: "signalforge",
              involved_kind: "Pod",
              involved_name: "signalforge-agent",
              reason: "FailedScheduling",
              message: "0/2 nodes are available: 2 Insufficient cpu.",
              count: 1,
              last_timestamp: "2026-03-30T19:15:05Z",
            },
          ]),
        },
        {
          path: "autoscaling/horizontal-pod-autoscalers.json",
          kind: "horizontal-pod-autoscalers",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
        {
          path: "policy/pod-disruption-budgets.json",
          kind: "pod-disruption-budgets",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
        {
          path: "quotas/resource-quotas.json",
          kind: "resource-quotas",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
        {
          path: "quotas/limit-ranges.json",
          kind: "limit-ranges",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
        {
          path: "workloads/rollout-status.json",
          kind: "workload-rollout-status",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
        {
          path: "logs/unhealthy-workload-excerpts.json",
          kind: "unhealthy-workload-log-excerpts",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
        {
          path: "storage/persistent-volume-claims.json",
          kind: "persistent-volume-claims",
          media_type: "application/json",
          content: JSON.stringify([]),
        },
      ],
    });

    const modules = buildRunDetailSummaryModules(run, bundle);

    expect(modules.map((module) => module.id)).toEqual(
      expect.arrayContaining([
        "kubernetes-capacity-snapshot",
        "run-health-summary",
        "kubernetes-node-capacity-bars",
        "kubernetes-top-consumers",
        "kubernetes-guardrails",
        "kubernetes-instability-callouts",
      ])
    );

    const capacity = modules.find((module) => module.id === "kubernetes-capacity-snapshot");
    expect(capacity).toMatchObject({
      prominence: "primary",
      kind: "stat-grid",
      stats: expect.arrayContaining([
        expect.objectContaining({ label: "Peak memory", value: "85.0%" }),
        expect.objectContaining({ label: "Peak CPU", value: "34.0%" }),
      ]),
    });
    expect(modules.find((module) => module.id === "run-health-summary")).toMatchObject({
      prominence: "supporting",
    });
  });

  it("builds container runtime and resource modules from raw diagnostics", () => {
    const run = mkRun({
      artifact_type: "container-diagnostics",
      report: {
        summary: ["Summary"],
        findings: [],
        environment_context: {
          hostname: "dev-postgres-host",
          os: "Container (podman)",
          kernel: "podman",
          is_wsl: false,
          is_container: true,
          is_virtual_machine: false,
          ran_as_root: true,
          uptime: "unknown",
        },
        noise_or_expected: [],
        top_actions_now: ["Add a memory limit", "Review root filesystem mode", "Monitor runtime health"],
      },
    });

    const modules = buildRunDetailSummaryModules(
      run,
      `=== container-diagnostics ===
runtime: podman
state_status: restarting
health_status: unhealthy
restart_count: 6
oom_killed: true
ran_as_root: true
read_only_rootfs: false
pid_count: 9
memory_limit_bytes: 536870912
memory_reservation_bytes: 268435456
cpu_percent: 7.20
memory_percent: 96.10
failure_log_excerpts_json: [{"source":"current","reason":"restarting","excerpt_lines":["database connection refused"]}]`
    );

    expect(modules.map((module) => module.id)).toEqual(
      expect.arrayContaining([
        "container-runtime-health",
        "container-resource-snapshot",
        "container-guardrails",
        "container-failure-callouts",
      ])
    );

    const runtime = modules.find((module) => module.id === "container-runtime-health");
    expect(runtime).toMatchObject({
      prominence: "primary",
      tone: "critical",
      kind: "stat-grid",
      stats: expect.arrayContaining([
        expect.objectContaining({ label: "Runtime state", value: "restarting" }),
        expect.objectContaining({ label: "Health", value: "unhealthy" }),
        expect.objectContaining({ label: "Restarts", value: "6" }),
        expect.objectContaining({ label: "OOM killed", value: "Yes" }),
      ]),
    });
  });

  it("builds Linux host pressure modules from raw audit content", async () => {
    const fixture = await import("node:fs/promises").then((fs) =>
      fs.readFile("tests/fixtures/sample-prod-server.log", "utf8")
    );
    const run = mkRun({
      artifact_type: "linux-audit-log",
      report: {
        summary: ["Summary"],
        findings: [
          mkFinding("1", "45 packages pending upgrade", "medium", {
            category: "packages",
            why_it_matters: "Pending package updates can leave fixes unapplied.",
          }),
          mkFinding("2", "Disk usage warning: /dev/sdb1 at 78%", "medium", {
            category: "disk",
            why_it_matters: "Data volume is filling.",
          }),
        ],
        environment_context: {
          hostname: "web-server-prod-01",
          os: "Ubuntu",
          kernel: "6.8",
          is_wsl: false,
          is_container: false,
          is_virtual_machine: false,
          ran_as_root: false,
          uptime: "1 day",
        },
        noise_or_expected: [],
        top_actions_now: ["Patch packages", "Watch the data volume", "Review recent errors"],
      },
    });

    const modules = buildRunDetailSummaryModules(run, fixture);
    expect(modules.map((module) => module.id)).toEqual(
      expect.arrayContaining([
        "host-pressure-snapshot",
        "host-storage-watch",
        "host-pressure-callouts",
      ])
    );

    const snapshot = modules.find((module) => module.id === "host-pressure-snapshot");
    expect(snapshot).toMatchObject({
      prominence: "primary",
      kind: "stat-grid",
      stats: expect.arrayContaining([
        expect.objectContaining({ label: "Peak disk use", value: "78%" }),
        expect.objectContaining({ label: "Pending upgrades", value: "0" }),
      ]),
    });
  });
});
