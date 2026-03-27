import { describe, expect, it } from "vitest";
import type { Finding, Severity } from "@/lib/analyzer/schema";
import {
  classifyFindingSignal,
  summarizeFindingSignals,
} from "@/lib/findings-presentation";

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

describe("findings-presentation", () => {
  it("classifies exposure findings from network reachability language", () => {
    const finding = mkFinding(
      "f-exposure",
      "Service exposed externally",
      "high",
      { evidence: "LoadBalancer service publishes ports publicly" }
    );

    expect(classifyFindingSignal(finding)).toBe("exposure");
  });

  it("classifies identity findings from RBAC and token language", () => {
    const finding = mkFinding(
      "f-identity",
      "Service account is bound to cluster-admin",
      "critical",
      { category: "rbac", why_it_matters: "RBAC scope and token handling are excessive" }
    );

    expect(classifyFindingSignal(finding)).toBe("identity");
  });

  it("classifies hardening findings from privilege and isolation language", () => {
    const finding = mkFinding(
      "f-hardening",
      "Container runs privileged",
      "high",
      { recommended_action: "Drop privileged mode and mount the root filesystem read-only" }
    );

    expect(classifyFindingSignal(finding)).toBe("hardening");
  });

  it("classifies stability findings from crash, probe, and pressure language", () => {
    const finding = mkFinding(
      "f-stability",
      "Workload is in CrashLoopBackOff",
      "medium",
      { why_it_matters: "Repeated restarts and missing probes hide real pressure" }
    );

    expect(classifyFindingSignal(finding)).toBe("stability");
  });

  it("keeps uncategorized findings in the other bucket", () => {
    const finding = mkFinding("f-other", "Deprecated package mirror configured", "low");

    expect(classifyFindingSignal(finding)).toBe("other");
  });

  it("summarizes counts and highest severities per signal", () => {
    const findings: Finding[] = [
      mkFinding("1", "Service exposed externally", "high", {
        evidence: "LoadBalancer service publishes ports publicly",
      }),
      mkFinding("2", "Container runs privileged", "medium", {
        recommended_action: "Drop privileged mode",
      }),
      mkFinding("3", "Service account is bound to cluster-admin", "critical", {
        category: "rbac",
      }),
      mkFinding("4", "Workload is in CrashLoopBackOff", "low", {
        why_it_matters: "CrashLoopBackOff and restart pressure",
      }),
      mkFinding("5", "Missing readiness probe", "high", {
        why_it_matters: "Missing liveness or readiness probes",
      }),
    ];

    const summary = summarizeFindingSignals(findings);

    expect(summary.find((item) => item.signal === "exposure")).toMatchObject({
      count: 1,
      highestSeverity: "high",
      sampleTitle: "Service exposed externally",
    });
    expect(summary.find((item) => item.signal === "identity")).toMatchObject({
      count: 1,
      highestSeverity: "critical",
    });
    expect(summary.find((item) => item.signal === "hardening")).toMatchObject({
      count: 1,
      highestSeverity: "medium",
    });
    expect(summary.find((item) => item.signal === "stability")).toMatchObject({
      count: 2,
      highestSeverity: "high",
    });
  });
});
