import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/analyzer/schema";
import {
  compareFindingsDrift,
  findingMatchKey,
  normalizeFindingTitle,
} from "@/lib/compare/findings-diff";

function f(partial: Partial<Finding> & Pick<Finding, "id" | "title" | "severity" | "category">): Finding {
  return {
    section_source: "sec",
    evidence: "ev",
    why_it_matters: "w",
    recommended_action: "r",
    ...partial,
  };
}

describe("findings-diff", () => {
  it("normalizeFindingTitle collapses whitespace and lowercases", () => {
    expect(normalizeFindingTitle("  Foo   BAR\tbaz  ")).toBe("foo bar baz");
  });

  it("normalizes volatile numeric titles for count-based findings", () => {
    expect(normalizeFindingTitle("45 packages available for upgrade")).toBe(
      "packages pending upgrade"
    );
    expect(normalizeFindingTitle("46 packages can be upgraded")).toBe(
      "packages pending upgrade"
    );
    expect(normalizeFindingTitle("47 packages pending upgrade")).toBe(
      "packages pending upgrade"
    );
    expect(normalizeFindingTitle("91 failed authentication attempts detected")).toBe(
      "repeated failed authentication attempts detected"
    );
    expect(normalizeFindingTitle("13 non-trivial errors in recent logs")).toBe(
      "elevated non-trivial errors in recent logs"
    );
    expect(normalizeFindingTitle("Disk usage critical: /dev/sda1 at 94%")).toBe(
      "disk usage critical: /dev/sda1"
    );
  });

  it("findingMatchKey includes category, normalized title, and section_source", () => {
    const a = f({
      id: "1",
      title: "Hello",
      severity: "low",
      category: "cat",
      section_source: "s1",
    });
    const b = f({
      id: "2",
      title: "hello",
      severity: "high",
      category: "cat",
      section_source: "s1",
    });
    expect(findingMatchKey(a)).toBe(findingMatchKey(b));
    const c = f({ ...a, section_source: "s2" });
    expect(findingMatchKey(c)).not.toBe(findingMatchKey(a));
  });

  it("classifies new, resolved, severity up/down, and unchanged", () => {
    const baseline: Finding[] = [
      f({
        id: "1",
        title: "Same",
        severity: "low",
        category: "c",
        section_source: "s",
        evidence: "e1",
      }),
      f({
        id: "2",
        title: "Gone",
        severity: "medium",
        category: "c",
        section_source: "s2",
        evidence: "e2",
      }),
      f({
        id: "3",
        title: "Worse",
        severity: "low",
        category: "c",
        section_source: "s3",
        evidence: "e3",
      }),
    ];
    const current: Finding[] = [
      f({
        id: "10",
        title: "Same",
        severity: "low",
        category: "c",
        section_source: "s",
        evidence: "e1b",
      }),
      f({
        id: "11",
        title: "Fresh",
        severity: "high",
        category: "c",
        section_source: "s-new",
        evidence: "enew",
      }),
      f({
        id: "12",
        title: "Worse",
        severity: "high",
        category: "c",
        section_source: "s3",
        evidence: "e3b",
      }),
    ];

    const d = compareFindingsDrift(baseline, current);
    expect(d.summary.new).toBe(1);
    expect(d.summary.resolved).toBe(1);
    expect(d.summary.severity_up).toBe(1);
    expect(d.summary.severity_down).toBe(0);
    expect(d.summary.unchanged).toBe(1);

    const statuses = new Set(d.rows.map((r) => r.status));
    expect(statuses.has("new")).toBe(true);
    expect(statuses.has("resolved")).toBe(true);
    expect(statuses.has("severity_up")).toBe(true);
  });

  it("sorts rows by match key for stable output", () => {
    const baseline: Finding[] = [
      f({ id: "a", title: "Zebra", severity: "low", category: "z", section_source: "s" }),
    ];
    const current: Finding[] = [
      f({ id: "b", title: "Apple", severity: "low", category: "a", section_source: "s" }),
    ];
    const d = compareFindingsDrift(baseline, current);
    const keys = d.rows.map((r) => r.match_key);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it("treats package-count title changes as the same ongoing finding", () => {
    const baseline: Finding[] = [
      f({
        id: "1",
        title: "45 packages pending upgrade",
        severity: "medium",
        category: "packages",
        section_source: "INSTALLED PACKAGES",
      }),
    ];
    const current: Finding[] = [
      f({
        id: "2",
        title: "46 packages can be upgraded",
        severity: "medium",
        category: "packages",
        section_source: "INSTALLED PACKAGES",
      }),
    ];

    const d = compareFindingsDrift(baseline, current);
    expect(d.summary.unchanged).toBe(1);
    expect(d.summary.new).toBe(0);
    expect(d.summary.resolved).toBe(0);
    expect(d.rows).toHaveLength(0);
  });

  it("still distinguishes findings where the numeric value is the identity", () => {
    const a = f({
      id: "1",
      title: "Service listening on port 8080",
      severity: "medium",
      category: "network",
      section_source: "NETWORK CONFIGURATION",
    });
    const b = f({ ...a, id: "2", title: "Service listening on port 9090" });
    expect(findingMatchKey(a)).not.toBe(findingMatchKey(b));
  });

  it("normalizes linux-audit-log listener titles across wording changes (compare stability)", () => {
    const oldLoopback = "Node service listening on loopback only (port 37437)";
    const newLoopback =
      "Node.js (local-only; likely dev or tooling) listening on loopback only — not reachable remotely (port 37437)";
    expect(normalizeFindingTitle(oldLoopback)).toBe(normalizeFindingTitle(newLoopback));
    expect(normalizeFindingTitle(oldLoopback)).toBe("network listener loopback port 37437");

    const oldWildcard = "Prometheus server exposed on all interfaces (port 9090)";
    const newWildcard = "Prometheus server reachable on all network interfaces (port 9090)";
    expect(normalizeFindingTitle(oldWildcard)).toBe(normalizeFindingTitle(newWildcard));
    expect(normalizeFindingTitle(newWildcard)).toBe("network listener all interfaces port 9090");
  });

  it("treats improved listener titles as the same finding for drift compare", () => {
    const baseline: Finding[] = [
      f({
        id: "1",
        title: "Web service exposed on all interfaces (port 80)",
        severity: "medium",
        category: "network",
        section_source: "NETWORK CONFIGURATION",
      }),
    ];
    const current: Finding[] = [
      f({
        id: "2",
        title: "HTTP listener (web) reachable on all network interfaces (port 80)",
        severity: "medium",
        category: "network",
        section_source: "NETWORK CONFIGURATION",
      }),
    ];
    const d = compareFindingsDrift(baseline, current);
    expect(d.summary.unchanged).toBe(1);
    expect(d.rows).toHaveLength(0);
  });

  it("treats container published ports title drift as the same ongoing finding", () => {
    const baseline: Finding[] = [
      f({
        id: "1",
        title: "Container publishes ports: 8080/tcp",
        severity: "medium",
        category: "network",
        section_source: "published_ports",
      }),
    ];
    const current: Finding[] = [
      f({
        id: "2",
        title: "Container publishes ports: 8443/tcp, 8080/tcp",
        severity: "medium",
        category: "network",
        section_source: "published_ports",
      }),
    ];
    const d = compareFindingsDrift(baseline, current);
    expect(d.summary.unchanged).toBe(1);
    expect(d.rows).toHaveLength(0);
  });

  it("normalizes Kubernetes workload titles when only trailing count suffixes change", () => {
    expect(
      normalizeFindingTitle(
        "Kubernetes workload service account is bound to wildcard RBAC roles: payments/payments-api (1 roles)"
      )
    ).toBe(
      "kubernetes workload service account is bound to wildcard rbac roles: payments/payments-api"
    );
    expect(
      normalizeFindingTitle(
        "Kubernetes externally exposed workload service account is bound to wildcard RBAC roles: payments/payments-api (2 roles)"
      )
    ).toBe(
      "kubernetes externally exposed workload service account is bound to wildcard rbac roles: payments/payments-api"
    );
    expect(
      normalizeFindingTitle(
        "Kubernetes workload injects Secret values into environment variables: payments/payments-api (3 refs)"
      )
    ).toBe(
      "kubernetes workload injects secret values into environment variables: payments/payments-api"
    );
    expect(
      normalizeFindingTitle(
        "Kubernetes workload mounts Secret volumes: payments/payments-api (2 mounts)"
      )
    ).toBe("kubernetes workload mounts secret volumes: payments/payments-api");
    expect(
      normalizeFindingTitle(
        "Kubernetes externally exposed workload mounts projected service account token volumes: payments/payments-api (2 mounts)"
      )
    ).toBe(
      "kubernetes externally exposed workload mounts projected service account token volumes: payments/payments-api"
    );
    expect(
      normalizeFindingTitle(
        "Kubernetes workload adds Linux capabilities: payments/payments-api (4 capabilities)"
      )
    ).toBe("kubernetes workload adds linux capabilities: payments/payments-api");
  });

  it("normalizes Kubernetes operational titles when only counts or percentages change", () => {
    expect(
      normalizeFindingTitle(
        "Kubernetes warning events indicate scheduling failures (12 events)"
      )
    ).toBe("kubernetes warning events indicate scheduling failures");
    expect(
      normalizeFindingTitle(
        "Kubernetes warning events indicate image pull failures (3 events)"
      )
    ).toBe("kubernetes warning events indicate image pull failures");
    expect(
      normalizeFindingTitle(
        "Kubernetes node memory usage is elevated: aks-nodepool1-000001 (91.0%)"
      )
    ).toBe("kubernetes node memory usage is elevated: aks-nodepool1-000001");
    expect(
      normalizeFindingTitle(
        "Kubernetes node CPU usage is elevated: aks-nodepool1-000001 (93.5%)"
      )
    ).toBe("kubernetes node cpu usage is elevated: aks-nodepool1-000001");
    expect(
      normalizeFindingTitle(
        "Kubernetes rollout incomplete: Deployment payments/payments-api (ready 1/3, updated 2/3)"
      )
    ).toBe("kubernetes rollout incomplete: deployment payments/payments-api");
    expect(
      normalizeFindingTitle(
        "Kubernetes ResourceQuota is near exhaustion: payments/quota (cpu at 92.5%)"
      )
    ).toBe("kubernetes resourcequota is near exhaustion: payments/quota (cpu)");
  });

  it("treats Kubernetes operational metric drift as the same ongoing finding", () => {
    const baseline: Finding[] = [
      f({
        id: "1",
        title:
          "Kubernetes warning events indicate scheduling failures (8 events)",
        severity: "high",
        category: "kubernetes",
        section_source: "events/warning-events.json",
      }),
      f({
        id: "2",
        title:
          "Kubernetes node memory usage is elevated: aks-nodepool1-000001 (91.0%)",
        severity: "medium",
        category: "kubernetes",
        section_source: "metrics/node-top.json",
      }),
      f({
        id: "3",
        title:
          "Kubernetes rollout incomplete: Deployment payments/payments-api (ready 1/3, updated 2/3)",
        severity: "high",
        category: "kubernetes",
        section_source: "workloads/rollout-status.json",
      }),
      f({
        id: "4",
        title: "Kubernetes ResourceQuota is near exhaustion: payments/quota (cpu at 92.5%)",
        severity: "medium",
        category: "kubernetes",
        section_source: "quotas/resource-quotas.json",
      }),
    ];
    const current: Finding[] = [
      f({
        id: "5",
        title:
          "Kubernetes warning events indicate scheduling failures (14 events)",
        severity: "high",
        category: "kubernetes",
        section_source: "events/warning-events.json",
      }),
      f({
        id: "6",
        title:
          "Kubernetes node memory usage is elevated: aks-nodepool1-000001 (94.2%)",
        severity: "medium",
        category: "kubernetes",
        section_source: "metrics/node-top.json",
      }),
      f({
        id: "7",
        title:
          "Kubernetes rollout incomplete: Deployment payments/payments-api (ready 2/3, updated 3/3)",
        severity: "high",
        category: "kubernetes",
        section_source: "workloads/rollout-status.json",
      }),
      f({
        id: "8",
        title: "Kubernetes ResourceQuota is near exhaustion: payments/quota (cpu at 96.0%)",
        severity: "medium",
        category: "kubernetes",
        section_source: "quotas/resource-quotas.json",
      }),
    ];

    const d = compareFindingsDrift(baseline, current);
    expect(d.summary.unchanged).toBe(4);
    expect(d.summary.new).toBe(0);
    expect(d.summary.resolved).toBe(0);
    expect(d.rows).toHaveLength(0);
  });

  it("treats Kubernetes count-only title drift as the same ongoing finding", () => {
    const baseline: Finding[] = [
      f({
        id: "1",
        title:
          "Kubernetes workload service account is bound to wildcard RBAC roles: payments/payments-api (1 roles)",
        severity: "high",
        category: "kubernetes",
        section_source: "workloads/specs.json",
      }),
      f({
        id: "2",
        title:
          "Kubernetes workload mounts Secret volumes: payments/payments-api (1 mounts)",
        severity: "medium",
        category: "kubernetes",
        section_source: "workloads/specs.json",
      }),
    ];
    const current: Finding[] = [
      f({
        id: "3",
        title:
          "Kubernetes workload service account is bound to wildcard RBAC roles: payments/payments-api (2 roles)",
        severity: "high",
        category: "kubernetes",
        section_source: "workloads/specs.json",
      }),
      f({
        id: "4",
        title:
          "Kubernetes workload mounts Secret volumes: payments/payments-api (3 mounts)",
        severity: "medium",
        category: "kubernetes",
        section_source: "workloads/specs.json",
      }),
    ];

    const d = compareFindingsDrift(baseline, current);
    expect(d.summary.unchanged).toBe(2);
    expect(d.summary.new).toBe(0);
    expect(d.summary.resolved).toBe(0);
    expect(d.rows).toHaveLength(0);
  });
});
