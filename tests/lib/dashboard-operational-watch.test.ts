import { describe, expect, it } from "vitest";
import type { Finding, Severity } from "@/lib/analyzer/schema";
import { buildDashboardOperationalWatch } from "@/lib/dashboard-operational-watch";
import type { RunSummary } from "@/types/api";

function mkRun(id: string, target: string): RunSummary {
  return {
    id,
    artifact_id: `artifact-${id}`,
    filename: `${target}.json`,
    artifact_type: "kubernetes-bundle",
    source_type: "agent",
    created_at: "2026-03-27T09:00:00.000Z",
    created_at_label: "1h ago",
    status: "complete",
    severity_counts: { critical: 0, high: 1, medium: 0, low: 0 },
    hostname: null,
    env_tags: [],
    target_identifier: target,
    collector_type: "signalforge-agent",
  };
}

function mkFinding(
  id: string,
  title: string,
  severity: Severity,
  section_source: string,
  evidence: Record<string, unknown> | string = {}
): Finding {
  return {
    id,
    title,
    severity,
    category: "runtime",
    section_source,
    evidence: typeof evidence === "string" ? evidence : JSON.stringify(evidence),
    why_it_matters: "why",
    recommended_action: "action",
  };
}

describe("dashboard-operational-watch", () => {
  it("groups recent findings into fleet-level lanes and dedupes run counts", () => {
    const watch = buildDashboardOperationalWatch([
      {
        run: mkRun("run-1", "payments-cluster"),
        target_name: "payments-cluster",
        findings: [
          mkFinding(
            "f-1",
            "Kubernetes warning events indicate scheduling failures (2 events)",
            "high",
            "logs/unhealthy-workload-excerpts.json",
            {
              workload_kind: "Deployment",
              namespace: "payments",
              workload_name: "api",
              reasons: ["CrashLoopBackOff"],
              samples: [
                {
                  reason: "CrashLoopBackOff",
                  excerpt_lines: ["panic: database connection refused"],
                },
              ],
            }
          ),
          mkFinding(
            "f-2",
            "Kubernetes rollout incomplete: Deployment payments/api (ready 1/4, updated 2/4)",
            "high",
            "workloads/rollout-status.json",
            {
              kind: "Deployment",
              namespace: "payments",
              name: "api",
              desired_replicas: 4,
              ready_replicas: 1,
              updated_replicas: 2,
              unavailable_replicas: 3,
            }
          ),
          mkFinding(
            "f-3",
            "Kubernetes ResourceQuota is near exhaustion: payments/payments-quota (limits.memory at 92.5%)",
            "medium",
            "quotas/resource-quotas.json",
            {
              namespace: "payments",
              name: "payments-quota",
              resource: {
                resource: "limits.memory",
                used_ratio: 0.925,
              },
            }
          ),
          mkFinding(
            "f-4",
            "PersistentVolumeClaim is Pending: payments/payments-data",
            "high",
            "storage/persistent-volume-claims.json",
            {
              namespace: "payments",
              name: "payments-data",
              requested_storage: "50Gi",
              storage_class_name: "managed-csi",
            }
          ),
        ],
      },
      {
        run: mkRun("run-2", "payments-cluster"),
        target_name: "payments-cluster",
        findings: [
          mkFinding(
            "f-5",
            "Kubernetes node memory usage is elevated: aks-system-000001 (91.0%)",
            "medium",
            "metrics/node-top.json",
            {
              name: "aks-system-000001",
              memory_percent: 91,
            }
          ),
          mkFinding(
            "f-6",
            "PersistentVolume is released: pv-payments-data",
            "medium",
            "storage/persistent-volumes.json",
            {
              name: "pv-payments-data",
              phase: "Released",
              reclaim_policy: "Delete",
            }
          ),
          mkFinding(
            "f-7",
            "Kubernetes unhealthy workload log excerpts captured: Deployment payments/api",
            "high",
            "logs/unhealthy-workload-excerpts.json",
            {
              workload_kind: "Deployment",
              namespace: "payments",
              workload_name: "api",
              reasons: ["CrashLoopBackOff"],
              samples: [
                {
                  reason: "CrashLoopBackOff",
                  excerpt_lines: ["panic: dependency unavailable"],
                },
              ],
            }
          ),
        ],
      },
    ]);

    expect(watch.map((lane) => lane.id)).toEqual([
      "failure",
      "rollout",
      "capacity",
      "storage",
    ]);

    const failure = watch.find((lane) => lane.id === "failure");
    const rollout = watch.find((lane) => lane.id === "rollout");
    const capacity = watch.find((lane) => lane.id === "capacity");
    const storage = watch.find((lane) => lane.id === "storage");

    expect(failure).toMatchObject({
      run_count: 2,
      items: [
        {
          label: "Deployment payments/api",
          detail: "CrashLoopBackOff · panic: database connection refused",
        },
        {
          label: "Deployment payments/api",
          detail: "CrashLoopBackOff · panic: dependency unavailable",
        },
      ],
    });
    expect(rollout).toMatchObject({
      run_count: 1,
      items: [
        {
          label: "Deployment payments/api",
          detail: "Ready 1/4 · updated 2 · unavailable 3",
        },
      ],
    });
    expect(capacity).toMatchObject({
      run_count: 2,
      items: [
        {
          label: "Quota payments/payments-quota",
          detail: "limits.memory at 92.5%",
        },
        {
          label: "aks-system-000001",
          detail: "91.0% memory used",
        },
      ],
    });
    expect(storage).toMatchObject({
      run_count: 2,
      items: [
        {
          label: "PVC payments/payments-data",
          detail: "Pending · requested 50Gi · class managed-csi",
        },
        {
          label: "PV pv-payments-data",
          detail: "Released · reclaim Delete",
        },
      ],
    });
  });

  it("surfaces scheduling pressure with aggregated warning-event counts", () => {
    const watch = buildDashboardOperationalWatch([
      {
        run: mkRun("run-sched", "oke-cluster"),
        target_name: "oke-cluster",
        findings: [
          mkFinding(
            "sched-1",
            "Kubernetes warning events indicate scheduling failures (27 events)",
            "high",
            "events/warning-events.json",
            {
              warning_event_count: 27,
              namespaces: ["signalforge"],
              affected_objects: ["Pod/signalforge-agent"],
              samples: [
                {
                  reason: "FailedScheduling",
                  message: "0/2 nodes are available: 2 Insufficient cpu.",
                  count: 27,
                },
              ],
            }
          ),
        ],
      },
    ]);

    expect(watch.map((lane) => lane.id)).toEqual(["scheduling"]);
    expect(watch[0]).toMatchObject({
      id: "scheduling",
      tone: "critical",
      run_count: 1,
      items: [
        {
          label: "Pod/signalforge-agent",
          detail: expect.stringContaining("27 events"),
        },
      ],
    });
  });

  it("groups container and linux runtime pressure into the runtime lane", () => {
    const watch = buildDashboardOperationalWatch([
      {
        run: mkRun("run-container", "postgres-db"),
        target_name: "postgres-db",
        findings: [
          mkFinding(
            "c-1",
            "Container memory usage is elevated (96.1%)",
            "high",
            "memory_percent",
            "96.1"
          ),
          mkFinding(
            "c-2",
            "Container was OOM-killed",
            "critical",
            "oom_killed",
            "true"
          ),
        ],
      },
      {
        run: mkRun("run-linux", "web-server-prod-01"),
        target_name: "web-server-prod-01",
        findings: [
          mkFinding(
            "l-1",
            "Disk usage warning: /dev/sdb1 at 78%",
            "medium",
            "DISK & MEMORY USAGE",
            "/dev/sdb1 78%"
          ),
          mkFinding(
            "l-2",
            "Recent syslog errors observed (3 lines)",
            "medium",
            "RECENT ERRORS & LOGS",
            "3 errors"
          ),
        ],
      },
    ]);

    const runtime = watch.find((lane) => lane.id === "runtime");
    expect(runtime).toMatchObject({
      run_count: 2,
      items: [
        expect.objectContaining({
          label: "postgres-db",
          detail: "Memory 96.1%",
        }),
        expect.objectContaining({
          label: "/dev/sdb1",
          detail: "Warning disk use at 78%",
        }),
      ],
    });
  });
});
