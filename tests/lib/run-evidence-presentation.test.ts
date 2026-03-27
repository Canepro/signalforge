import { describe, expect, it } from "vitest";
import type { Finding, Severity } from "@/lib/analyzer/schema";
import { buildRunEvidenceSections } from "@/lib/run-evidence-presentation";

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

describe("run-evidence-presentation", () => {
  it("builds container runtime-health evidence from persisted findings", () => {
    const sections = buildRunEvidenceSections("container-diagnostics", [
      mkFinding("1", "Container runtime state is restarting", "high", {
        section_source: "state_status",
        evidence: "restarting",
      }),
      mkFinding("2", "Container health check is failing", "high", {
        section_source: "health_status",
        evidence: "unhealthy",
      }),
      mkFinding("3", "Container was OOM-killed", "high", {
        section_source: "oom_killed",
        evidence: "true",
      }),
      mkFinding("4", "Container restarted 6 times", "medium", {
        section_source: "restart_count",
        evidence: "6",
      }),
      mkFinding("5", "Container memory usage is elevated (96.1%)", "high", {
        section_source: "memory_percent",
        evidence: "96.1",
      }),
      mkFinding("6", "Container unhealthy log excerpts captured", "medium", {
        section_source: "failure_log_excerpts_json",
        evidence: JSON.stringify({
          excerpt_count: 2,
          samples: [
            {
              source: "current",
              reason: "restarting",
              excerpt_lines: [
                "2026-03-26T10:06:00Z retrying database connection",
                "2026-03-26T10:06:01Z health probe still failing",
              ],
            },
            {
              source: "previous",
              reason: "restarting",
              excerpt_lines: [
                "2026-03-26T10:05:10Z panic: database connection refused",
              ],
            },
          ],
        }),
      }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      id: "container-runtime-health",
      tone: "critical",
      entries: [
        { label: "Runtime state", value: "restarting", emphasis: true },
        { label: "Health", value: "unhealthy", emphasis: true },
        { label: "Restarts", value: "6", emphasis: true },
        { label: "OOM killed", value: "Yes", emphasis: true },
        { label: "Memory guardrail", value: "96.1%", emphasis: true },
      ],
    });
    expect(sections[1]).toMatchObject({
      id: "container-failure-excerpts",
      entries: [
        {
          label: "restarting · current logs",
          value:
            "2026-03-26T10:06:00Z retrying database connection\n"
            + "2026-03-26T10:06:01Z health probe still failing",
          emphasis: true,
        },
        {
          label: "restarting · previous logs",
          value: "2026-03-26T10:05:10Z panic: database connection refused",
          emphasis: true,
        },
      ],
    });
  });

  it("aggregates kubernetes rollout, pressure, and warning-event findings", () => {
    const sections = buildRunEvidenceSections("kubernetes-bundle", [
      mkFinding(
        "1",
        "Kubernetes rollout controller has not observed the latest spec generation: Deployment payments/api",
        "medium",
        {
          section_source: "workloads/rollout-status.json",
          evidence: JSON.stringify({
            kind: "Deployment",
            namespace: "payments",
            name: "api",
            generation: 9,
            observed_generation: 7,
          }),
        }
      ),
      mkFinding(
        "2",
        "Kubernetes rollout incomplete: Deployment payments/api (ready 1/4, updated 2/4)",
        "high",
        {
          section_source: "workloads/rollout-status.json",
          evidence: JSON.stringify({
            kind: "Deployment",
            namespace: "payments",
            name: "api",
            desired_replicas: 4,
            ready_replicas: 1,
            updated_replicas: 2,
            unavailable_replicas: 3,
          }),
        }
      ),
      mkFinding(
        "3",
        "Kubernetes node memory usage is elevated: aks-system-000001 (91.0%)",
        "medium",
        {
          section_source: "metrics/node-top.json",
          evidence: JSON.stringify({
            name: "aks-system-000001",
            memory_percent: 91,
          }),
        }
      ),
      mkFinding(
        "4",
        "Kubernetes warning events indicate scheduling failures (2 events)",
        "high",
        {
          section_source: "events/warning-events.json",
          evidence: JSON.stringify({
            warning_event_count: 2,
            namespaces: ["payments"],
            affected_objects: ["Pod/api-123"],
          }),
        }
      ),
      mkFinding(
        "5",
        "Kubernetes HPA is saturated at max replicas: payments/payments-api",
        "high",
        {
          section_source: "autoscaling/horizontal-pod-autoscalers.json",
          evidence: JSON.stringify({
            namespace: "payments",
            name: "payments-api",
            desired_replicas: 4,
            max_replicas: 4,
            current_cpu_utilization_percentage: 96,
            target_cpu_utilization_percentage: 70,
          }),
        }
      ),
      mkFinding(
        "6",
        "Kubernetes PodDisruptionBudget blocks voluntary disruption: payments/payments-api",
        "high",
        {
          section_source: "policy/pod-disruption-budgets.json",
          evidence: JSON.stringify({
            namespace: "payments",
            name: "payments-api",
            disruptions_allowed: 0,
            current_healthy: 1,
            desired_healthy: 2,
          }),
        }
      ),
      mkFinding(
        "7",
        "Kubernetes ResourceQuota is near exhaustion: payments/payments-quota (limits.memory at 92.5%)",
        "medium",
        {
          section_source: "quotas/resource-quotas.json",
          evidence: JSON.stringify({
            namespace: "payments",
            name: "payments-quota",
            resource: {
              resource: "limits.memory",
              used_ratio: 0.925,
            },
          }),
        }
      ),
      mkFinding(
        "8",
        "Kubernetes namespace lacks complete LimitRange defaults: payments",
        "medium",
        {
          section_source: "quotas/limit-ranges.json",
          evidence: JSON.stringify({
            namespace: "payments",
            missing: "default requests",
          }),
        }
      ),
      mkFinding(
        "9",
        "Kubernetes PersistentVolumeClaim is Pending: payments/payments-data",
        "medium",
        {
          section_source: "storage/persistent-volume-claims.json",
          evidence: JSON.stringify({
            namespace: "payments",
            name: "payments-data",
            requested_storage: "20Gi",
            storage_class_name: "managed-csi",
          }),
        }
      ),
      mkFinding(
        "10",
        "Kubernetes PersistentVolumeClaim is waiting for filesystem resize: payments/payments-cache",
        "medium",
        {
          section_source: "storage/persistent-volume-claims.json",
          evidence: JSON.stringify({
            namespace: "payments",
            name: "payments-cache",
          }),
        }
      ),
      mkFinding(
        "11",
        "Kubernetes PersistentVolume is released without reuse: pv-payments-archive",
        "medium",
        {
          section_source: "storage/persistent-volumes.json",
          evidence: JSON.stringify({
            name: "pv-payments-archive",
            phase: "Released",
            reclaim_policy: "Retain",
          }),
        }
      ),
      mkFinding(
        "12",
        "Kubernetes workload depends on a Pending PersistentVolumeClaim: payments/api -> payments-data",
        "high",
        {
          section_source: "workloads/specs.json",
          evidence: JSON.stringify({
            workload: {
              namespace: "payments",
              name: "api",
            },
            persistent_volume_claim: {
              namespace: "payments",
              name: "payments-data",
            },
          }),
        }
      ),
      mkFinding(
        "13",
        "Kubernetes unhealthy workload logs captured: payments/api",
        "medium",
        {
          section_source: "logs/unhealthy-workload-excerpts.json",
          evidence: JSON.stringify({
            namespace: "payments",
            workload_kind: "Deployment",
            workload_name: "api",
            reasons: ["CrashLoopBackOff"],
            samples: [
              {
                pod_name: "payments-api-abc123",
                container_name: "api",
                previous: true,
                reason: "CrashLoopBackOff",
                excerpt_lines: [
                  "2026-03-26T10:05:10Z panic: database connection refused",
                  "2026-03-26T10:05:11Z retry budget exhausted after 5 attempts",
                ],
              },
            ],
          }),
        }
      ),
    ]);

    expect(sections.map((section) => section.id)).toEqual([
      "kubernetes-rollout",
      "kubernetes-pressure",
      "kubernetes-warnings",
      "kubernetes-failure-excerpts",
      "kubernetes-guardrails",
    ]);

    expect(sections[0]).toMatchObject({
      tone: "critical",
      entries: expect.arrayContaining([
        {
          label: "Deployment payments/api",
          value: "Observed generation 7 of 9",
          emphasis: true,
        },
        {
          label: "Deployment payments/api",
          value: "Ready 1/4, updated 2, unavailable 3",
          emphasis: true,
        },
        {
          label: "HPA payments/payments-api",
          value: "Desired 4/4 · CPU 96% vs target 70%",
          emphasis: true,
        },
        {
          label: "PDB payments/payments-api",
          value: "Disruptions allowed 0, healthy 1/2",
          emphasis: true,
        },
      ]),
    });

    expect(sections[1]).toMatchObject({
      entries: expect.arrayContaining([
        {
          label: "aks-system-000001",
          value: "91.0% memory used",
          emphasis: true,
        },
        {
          label: "Quota payments/payments-quota",
          value: "limits.memory at 92.5%",
          emphasis: true,
        },
        {
          label: "PVC payments/payments-data",
          value: "Pending · requested 20Gi · class managed-csi",
          emphasis: true,
        },
        {
          label: "PVC payments/payments-cache",
          value: "Filesystem resize pending",
          emphasis: true,
        },
        {
          label: "PV pv-payments-archive",
          value: "Released · reclaim Retain",
          emphasis: true,
        },
        {
          label: "payments/api",
          value: "Blocked on pending PVC payments/payments-data",
          emphasis: true,
        },
      ]),
    });

    expect(sections[2]).toMatchObject({
      entries: [
        {
          label: "Kubernetes warning events indicate scheduling failures",
          value: "2 events across payments · Pod/api-123",
          emphasis: true,
        },
      ],
    });

    expect(sections[3]).toMatchObject({
      entries: [
        {
          label: "Deployment payments/api",
          value:
            "CrashLoopBackOff · previous logs from payments-api-abc123/api\n"
            + "2026-03-26T10:05:10Z panic: database connection refused\n"
            + "2026-03-26T10:05:11Z retry budget exhausted after 5 attempts",
          emphasis: true,
        },
      ],
    });

    expect(sections[4]).toMatchObject({
      entries: [
        {
          label: "payments",
          value: "default requests",
          emphasis: true,
        },
      ],
    });
  });
});
