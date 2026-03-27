import { describe, expect, it } from "vitest";
import type { EvidenceDeltaPayload } from "@/lib/compare/evidence-delta";
import {
  buildOperationalEvidenceDeltaSections,
  classifyEvidenceMetricFocus,
} from "@/lib/compare/evidence-delta-presentation";

const samplePayload: EvidenceDeltaPayload = {
  changed: true,
  summary: {
    metadata_changed: 0,
    metric_changes: 4,
    artifact_changed: true,
  },
  metadata: {
    filename: "unchanged",
    target_identifier: "unchanged",
    collected_at: "unchanged",
    collector_type: "unchanged",
    collector_version: "unchanged",
  },
  metrics: [
    {
      key: "rollout_issue_count",
      label: "Workloads with rollout issues",
      family: "kubernetes-bundle",
      status: "changed",
      previous: 2,
      current: 1,
      unit: null,
    },
    {
      key: "node_pressure_count",
      label: "Nodes with pressure conditions",
      family: "kubernetes-bundle",
      status: "changed",
      previous: 0,
      current: 1,
      unit: null,
    },
    {
      key: "resource_quota_pressure_count",
      label: "ResourceQuotas near exhaustion",
      family: "kubernetes-bundle",
      status: "changed",
      previous: 0,
      current: 2,
      unit: null,
    },
    {
      key: "restart_count",
      label: "Restart count",
      family: "container-diagnostics",
      status: "changed",
      previous: 1,
      current: 6,
      unit: null,
    },
    {
      key: "external_service_count",
      label: "External services",
      family: "kubernetes-bundle",
      status: "changed",
      previous: 1,
      current: 2,
      unit: null,
    },
    {
      key: "namespace_without_limit_range_default_count",
      label: "Namespaces missing full LimitRange defaults",
      family: "kubernetes-bundle",
      status: "changed",
      previous: 1,
      current: 0,
      unit: null,
    },
  ],
};

describe("evidence-delta-presentation", () => {
  it("classifies operational metric focus buckets", () => {
    expect(classifyEvidenceMetricFocus(samplePayload.metrics[0]!)).toBe("rollout");
    expect(classifyEvidenceMetricFocus(samplePayload.metrics[1]!)).toBe("pressure");
    expect(classifyEvidenceMetricFocus(samplePayload.metrics[2]!)).toBe("pressure");
    expect(classifyEvidenceMetricFocus(samplePayload.metrics[3]!)).toBe("runtime");
    expect(classifyEvidenceMetricFocus(samplePayload.metrics[4]!)).toBe("posture");
    expect(classifyEvidenceMetricFocus(samplePayload.metrics[5]!)).toBe("posture");
  });

  it("builds operational delta sections for compare surfaces", () => {
    const sections = buildOperationalEvidenceDeltaSections(samplePayload);

    expect(sections.map((section) => section.id)).toEqual([
      "compare-rollout",
      "compare-pressure",
      "compare-runtime",
      "compare-posture",
    ]);
    expect(sections[0]?.entries[0]).toMatchObject({
      label: "Workloads with rollout issues",
      value: "2 -> 1",
      emphasis: true,
    });
    expect(sections[1]?.entries[0]).toMatchObject({
      label: "Nodes with pressure conditions",
      value: "0 -> 1",
    });
    expect(sections[1]?.entries[1]).toMatchObject({
      label: "ResourceQuotas near exhaustion",
      value: "0 -> 2",
    });
    expect(sections[2]?.entries[0]).toMatchObject({
      label: "Restart count",
      value: "1 -> 6",
    });
    expect(sections[3]?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "External services",
          value: "1 -> 2",
        }),
        expect.objectContaining({
          label: "Namespaces missing full LimitRange defaults",
          value: "1 -> 0",
        }),
      ])
    );
  });
});
