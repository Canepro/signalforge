import { describe, it, expect } from "vitest";
import {
  compareTargetsMismatch,
  normalizeTargetIdentifier,
  preferredTargetDisplayLabel,
  preferredTargetMatchKey,
} from "@/lib/target-identity";

describe("target-identity", () => {
  it("normalizeTargetIdentifier trims and lowercases", () => {
    expect(normalizeTargetIdentifier("  Fleet:PROD  ")).toBe("fleet:prod");
    expect(normalizeTargetIdentifier("")).toBeNull();
    expect(normalizeTargetIdentifier(null)).toBeNull();
  });

  it("preferredTargetMatchKey prefers target_identifier over hostname", () => {
    expect(
      preferredTargetMatchKey({
        target_identifier: "A",
        environment_hostname: "host",
      })
    ).toBe("id:a");
    expect(
      preferredTargetMatchKey({
        target_identifier: null,
        environment_hostname: "Host",
      })
    ).toBe("host:host");
    expect(
      preferredTargetMatchKey({
        target_identifier: null,
        environment_hostname: null,
      })
    ).toBeNull();
  });

  it("preferredTargetMatchKey uses container identity before hostname fallback", () => {
    expect(
      preferredTargetMatchKey({
        target_identifier: null,
        environment_hostname: "node-a",
        artifact_type: "container-diagnostics",
        artifact_content: [
          "=== container-diagnostics ===",
          "runtime: docker",
          "container_name: payments",
          "image: registry.example/payments:1.2.3",
        ].join("\n"),
      })
    ).toBe("container:node-a:payments");
  });

  it("preferredTargetMatchKey uses Kubernetes cluster scope before hostname fallback", () => {
    expect(
      preferredTargetMatchKey({
        target_identifier: null,
        environment_hostname: "aks-prod-eu-1",
        artifact_type: "kubernetes-bundle",
        artifact_content: JSON.stringify({
          schema_version: "kubernetes-bundle.v1",
          cluster: { name: "aks-prod-eu-1", provider: "aks" },
          scope: { level: "namespace", namespace: "payments" },
          documents: [],
        }),
      })
    ).toBe("k8s:aks-prod-eu-1:namespace:payments");
  });

  it("preferredTargetDisplayLabel prefers id string over hostname", () => {
    expect(
      preferredTargetDisplayLabel({
        target_identifier: "my-id",
        environment_hostname: "h",
      })
    ).toBe("my-id");
    expect(
      preferredTargetDisplayLabel({
        target_identifier: null,
        environment_hostname: "h",
      })
    ).toBe("h");
  });

  it("preferredTargetDisplayLabel uses container identity when no target_identifier is present", () => {
    expect(
      preferredTargetDisplayLabel({
        target_identifier: null,
        environment_hostname: "node-a",
        artifact_type: "container-diagnostics",
        artifact_content: [
          "=== container-diagnostics ===",
          "runtime: docker",
          "container_name: payments",
        ].join("\n"),
      })
    ).toBe("payments @ node-a");
  });

  it("preferredTargetDisplayLabel uses Kubernetes cluster and scope when no target_identifier is present", () => {
    expect(
      preferredTargetDisplayLabel({
        target_identifier: null,
        environment_hostname: "aks-prod-eu-1",
        artifact_type: "kubernetes-bundle",
        artifact_content: JSON.stringify({
          schema_version: "kubernetes-bundle.v1",
          cluster: { name: "aks-prod-eu-1", provider: "aks" },
          scope: { level: "namespace", namespace: "payments" },
          documents: [],
        }),
      })
    ).toBe("aks-prod-eu-1 / namespace payments");
  });

  it("compareTargetsMismatch matches same id with different hostnames", () => {
    expect(
      compareTargetsMismatch(
        { target_identifier: "x", environment_hostname: "a" },
        { target_identifier: "x", environment_hostname: "b" }
      )
    ).toBe(false);
  });

  it("compareTargetsMismatch when same hostname but different ids", () => {
    expect(
      compareTargetsMismatch(
        { target_identifier: "a", environment_hostname: "h" },
        { target_identifier: "b", environment_hostname: "h" }
      )
    ).toBe(true);
  });

  it("compareTargetsMismatch when one has id and other only hostname", () => {
    expect(
      compareTargetsMismatch(
        { target_identifier: "a", environment_hostname: "h" },
        { target_identifier: null, environment_hostname: "h" }
      )
    ).toBe(true);
  });

  it("compareTargetsMismatch false when both unknown", () => {
    expect(
      compareTargetsMismatch(
        { target_identifier: null, environment_hostname: null },
        { target_identifier: null, environment_hostname: null }
      )
    ).toBe(false);
  });

  it("compareTargetsMismatch detects different containers on the same host", () => {
    expect(
      compareTargetsMismatch(
        {
          target_identifier: null,
          environment_hostname: "node-a",
          artifact_type: "container-diagnostics",
          artifact_content: [
            "=== container-diagnostics ===",
            "runtime: docker",
            "container_name: payments",
          ].join("\n"),
        },
        {
          target_identifier: null,
          environment_hostname: "node-a",
          artifact_type: "container-diagnostics",
          artifact_content: [
            "=== container-diagnostics ===",
            "runtime: docker",
            "container_name: search",
          ].join("\n"),
        }
      )
    ).toBe(true);
  });
});
