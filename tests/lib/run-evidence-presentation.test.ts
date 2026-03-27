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
    ]);

    expect(sections).toHaveLength(1);
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
    ]);

    expect(sections.map((section) => section.id)).toEqual([
      "kubernetes-rollout",
      "kubernetes-pressure",
      "kubernetes-warnings",
    ]);

    expect(sections[0]).toMatchObject({
      tone: "critical",
      entries: [
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
      ],
    });

    expect(sections[1]).toMatchObject({
      entries: [
        {
          label: "aks-system-000001",
          value: "91.0% memory used",
          emphasis: true,
        },
      ],
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
  });
});
