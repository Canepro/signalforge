import { describe, expect, it } from "vitest";
import {
  COLLECTION_STACK_ROLES,
  DEFAULT_EXPECTED_ARTIFACT_TYPE,
  defaultCapabilitiesForArtifactType,
  getArtifactTypeLabel,
  getArtifactFamilyPresentation,
  getSourceTypeLabel,
  isSourceType,
  listArtifactFamilyPresentations,
  listSourceTypeOptions,
} from "@/lib/source-catalog";

describe("source-catalog", () => {
  it("lists the supported source types for operator-facing flows", () => {
    expect(listSourceTypeOptions().map((option) => option.value)).toEqual(["linux_host", "wsl"]);
    expect(isSourceType("linux_host")).toBe(true);
    expect(isSourceType("wsl")).toBe(true);
    expect(isSourceType("container_host")).toBe(false);
  });

  it("derives collect capabilities generically from artifact type", () => {
    expect(defaultCapabilitiesForArtifactType(DEFAULT_EXPECTED_ARTIFACT_TYPE)).toEqual([
      "collect:linux-audit-log",
    ]);
    expect(defaultCapabilitiesForArtifactType("container-diagnostics")).toEqual([
      "collect:container-diagnostics",
    ]);
    expect(defaultCapabilitiesForArtifactType("kubernetes-bundle")).toEqual([
      "collect:kubernetes-bundle",
    ]);
  });

  it("provides stable labels for the current source and artifact families", () => {
    expect(getSourceTypeLabel("linux_host")).toBe("Linux host");
    expect(getSourceTypeLabel("wsl")).toBe("WSL");
    expect(getArtifactTypeLabel("linux-audit-log")).toBe("Linux audit log");
    expect(getArtifactTypeLabel("container-diagnostics")).toBe("Container diagnostics");
    expect(getArtifactTypeLabel("kubernetes-bundle")).toBe("Kubernetes bundle");
  });

  it("exposes shared artifact-family presentation metadata for UI flows", () => {
    expect(listArtifactFamilyPresentations().map((family) => family.value)).toEqual([
      "linux-audit-log",
      "container-diagnostics",
      "kubernetes-bundle",
    ]);

    expect(getArtifactFamilyPresentation("container-diagnostics")).toMatchObject({
      targetIdentifierExample: "container-workload:host-a:podman:payments-api",
    });
  });

  it("describes the three collection-plane repo roles", () => {
    expect(COLLECTION_STACK_ROLES.map((entry) => entry.label)).toEqual([
      "signalforge",
      "signalforge-collectors",
      "signalforge-agent",
    ]);
  });
});
