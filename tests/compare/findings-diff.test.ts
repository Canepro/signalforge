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
});
