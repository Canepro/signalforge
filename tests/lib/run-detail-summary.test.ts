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
        "kubernetes-top-node-consumers",
        "kubernetes-top-pod-memory",
        "kubernetes-guardrails",
        "kubernetes-instability-callouts",
      ])
    );
    expect(modules.some((module) => module.id === "run-health-summary")).toBe(false);

    const capacity = modules.find((module) => module.id === "kubernetes-capacity-snapshot");
    expect(capacity).toMatchObject({
      prominence: "primary",
      kind: "stat-grid",
      stats: expect.arrayContaining([
        expect.objectContaining({ label: "Peak memory", value: "85.0%" }),
        expect.objectContaining({ label: "Peak CPU", value: "34.0%" }),
        expect.objectContaining({
          label: "Scheduling pressure",
          detail: expect.stringContaining("FailedScheduling"),
        }),
        expect.objectContaining({
          detail: expect.stringMatching(/insufficient cpu/i),
        }),
      ]),
    });
    expect(modules.find((module) => module.id === "priority-callouts")).toMatchObject({
      kind: "callout-list",
      callouts: expect.arrayContaining([
        expect.objectContaining({
          title: "Kubernetes warning events indicate scheduling failures (1 events)",
          tone: "critical",
        }),
      ]),
    });
  });

  it("sums aggregated FailedScheduling counts in the scheduling pressure stat", () => {
    const run = mkRun({
      artifact_type: "kubernetes-bundle",
      report: {
        summary: ["Summary"],
        findings: [],
        environment_context: mkRun().environment!,
        noise_or_expected: [],
        top_actions_now: [],
      },
    });

    const bundle = JSON.stringify({
      schema_version: "kubernetes-bundle.v1",
      cluster: { name: "demo-cluster", provider: "demo" },
      scope: { level: "cluster" },
      collected_at: "2026-03-30T20:08:30.447Z",
      collector: { type: "signalforge-collectors", version: "1.0.0" },
      documents: [
        {
          path: "events/warning-events.json",
          kind: "warning-events",
          media_type: "application/json",
          content: JSON.stringify([
            {
              namespace: "payments",
              involved_kind: "Pod",
              involved_name: "payments-api",
              reason: "FailedScheduling",
              message: "0/3 nodes are available: 3 Insufficient cpu.",
              count: 27,
              last_timestamp: "2026-03-30T19:15:05Z",
            },
          ]),
        },
      ],
    });

    const modules = buildRunDetailSummaryModules(run, bundle);
    const capacity = modules.find(
      (module) => module.id === "kubernetes-capacity-snapshot" && module.kind === "stat-grid"
    );
    expect(capacity?.kind === "stat-grid" ? capacity.stats : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Scheduling pressure",
          value: "27 events",
        }),
      ])
    );
  });

  it("omits priority callouts when the run has no findings", () => {
    const modules = buildRunDetailSummaryModules(
      mkRun({
        artifact_type: "container-diagnostics",
        report: {
          summary: ["Summary"],
          findings: [],
          environment_context: mkRun().environment!,
          noise_or_expected: [],
          top_actions_now: [],
        },
      }),
      "=== container-diagnostics ===\nruntime: podman"
    );
    expect(modules.some((module) => module.id === "priority-callouts")).toBe(false);
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

  it("derives container failure callout module tone from contained callouts", () => {
    const modules = buildRunDetailSummaryModules(
      mkRun({ artifact_type: "container-diagnostics" }),
      `=== container-diagnostics ===
runtime: podman
state_status: running
health_status: healthy
restart_count: 0
oom_killed: false
memory_limit_bytes: 0
cpu_percent: 4.00
memory_percent: 96.50`
    );

    expect(modules.find((module) => module.id === "container-failure-callouts")).toMatchObject({
      tone: "critical",
      callouts: expect.arrayContaining([
        expect.objectContaining({
          title: "Memory pressure without a limit",
          tone: "critical",
        }),
      ]),
    });
  });

  it("treats missing container memory limit as unknown instead of no limit", () => {
    const modules = buildRunDetailSummaryModules(
      mkRun({ artifact_type: "container-diagnostics" }),
      `=== container-diagnostics ===
runtime: podman
state_status: running
health_status: healthy
restart_count: 0
oom_killed: false
cpu_percent: 4.00
memory_percent: 96.50`
    );

    expect(modules.find((module) => module.id === "container-failure-callouts")).toMatchObject({
      tone: "warning",
      callouts: expect.arrayContaining([
        expect.objectContaining({
          title: "High memory utilization",
          body: expect.stringContaining("memory limit was not recorded"),
          tone: "warning",
        }),
      ]),
    });
  });

  it("uses kubernetes capacity modules without scheduling stats when metrics are absent", async () => {
    const bundle = await import("node:fs/promises").then((fs) =>
      fs.readFile("tests/fixtures/kubernetes-payments-bundle.json", "utf8")
    );
    const run = mkRun({
      artifact_type: "kubernetes-bundle",
      report: {
        summary: ["Summary"],
        findings: [],
        environment_context: {
          hostname: "aks-prod-eu-1",
          os: "Kubernetes (aks)",
          kernel: "k8s",
          is_wsl: false,
          is_container: false,
          is_virtual_machine: false,
          ran_as_root: false,
          uptime: "unknown",
        },
        noise_or_expected: [],
        top_actions_now: [],
      },
    });

    const modules = buildRunDetailSummaryModules(run, bundle);
    expect(modules.map((module) => module.id)).toEqual(
      expect.arrayContaining([
        "kubernetes-capacity-snapshot",
        "kubernetes-top-node-consumers",
        "kubernetes-top-pod-memory",
      ])
    );
    const capacityModule = modules.find(
      (module) => module.id === "kubernetes-capacity-snapshot" && module.kind === "stat-grid"
    );
    const capacityStats = capacityModule?.kind === "stat-grid" ? capacityModule.stats : [];
    expect(capacityStats.some((stat) => stat.label === "Scheduling pressure")).toBe(false);
    expect(modules.some((module) => module.id === "kubernetes-instability-callouts")).toBe(true);
  });

  it("returns no artifact-family modules when artifact bytes are missing", () => {
    const modules = buildRunDetailSummaryModules(
      mkRun({
        artifact_type: "kubernetes-bundle",
        report: {
          summary: ["Summary"],
          findings: [mkFinding("1", "Example finding", "high")],
          environment_context: mkRun().environment!,
          noise_or_expected: [],
          top_actions_now: [],
        },
      }),
      null
    );
    expect(modules.some((module) => module.id === "kubernetes-capacity-snapshot")).toBe(false);
    expect(modules.some((module) => module.id === "run-health-summary")).toBe(true);
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
    expect(modules.some((module) => module.id === "host-top-processes")).toBe(false);
  });

  it("builds Linux top-process bars when ps output is present", async () => {
    const fixture = await import("node:fs/promises").then((fs) =>
      fs.readFile("tests/fixtures/wsl-mar2026-full.log", "utf8")
    );
    const run = mkRun({
      artifact_type: "linux-audit-log",
      report: {
        summary: ["Summary"],
        findings: [],
        environment_context: mkRun().environment!,
        noise_or_expected: [],
        top_actions_now: [],
      },
    });

    const modules = buildRunDetailSummaryModules(run, fixture);
    const topProcesses = modules.find((module) => module.id === "host-top-processes");
    expect(topProcesses).toMatchObject({
      kind: "bar-list",
      bars: expect.arrayContaining([
        expect.objectContaining({
          value_label: expect.stringMatching(/% mem/),
        }),
      ]),
    });
  });

  it("de-duplicates filesystems captured by multiple df invocations, preferring df -h", async () => {
    const fixture = await import("node:fs/promises").then((fs) =>
      fs.readFile("tests/fixtures/linux-df-duplicate-mounts.log", "utf8")
    );
    const run = mkRun({
      artifact_type: "linux-audit-log",
      report: {
        summary: ["Summary"],
        findings: [],
        environment_context: mkRun().environment!,
        noise_or_expected: [],
        top_actions_now: [],
      },
    });

    const modules = buildRunDetailSummaryModules(run, fixture);
    const storage = modules.find((module) => module.id === "host-storage-watch");
    const bars = storage?.kind === "bar-list" ? storage.bars : [];

    // Each filesystem must appear exactly once even though the audit captured it
    // via `df -h`, `df` (1K-blocks), and `df -i` (inodes).
    const labels = bars.map((bar) => bar.label);
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels).toEqual(["/dev/sdb1 (/mnt/data)", "/dev/sda1 (/)"]);

    // The surviving row carries the human-readable `df -h` percentage (75%),
    // not the 1K-blocks (15%) or inode (2%) reading for the same mount.
    expect(bars.map((bar) => bar.value_label)).toEqual(["92%", "75%"]);
    const rootBar = bars.find((bar) => bar.label === "/dev/sda1 (/)");
    expect(rootBar?.value).toBe(75);

    // Peak disk use in the snapshot stat tracks the deduped df -h percentage.
    const snapshot = modules.find((module) => module.id === "host-pressure-snapshot");
    expect(snapshot).toMatchObject({
      kind: "stat-grid",
      stats: expect.arrayContaining([
        expect.objectContaining({ label: "Peak disk use", value: "92%" }),
      ]),
    });
  });

  it("collapses df -h and df -i rows for the same mount in real WSL audits", async () => {
    const fixture = await import("node:fs/promises").then((fs) =>
      fs.readFile("tests/fixtures/wsl-mar2026-full.log", "utf8")
    );
    const run = mkRun({
      artifact_type: "linux-audit-log",
      report: {
        summary: ["Summary"],
        findings: [],
        environment_context: mkRun().environment!,
        noise_or_expected: [],
        top_actions_now: [],
      },
    });

    const modules = buildRunDetailSummaryModules(run, fixture);
    const storage = modules.find((module) => module.id === "host-storage-watch");
    const bars = storage?.kind === "bar-list" ? storage.bars : [];

    const rootBars = bars.filter((bar) => bar.label === "/dev/sdd (/)");
    expect(rootBars).toHaveLength(1);
    expect(rootBars[0]?.value_label).toBe("5%");
  });
});
