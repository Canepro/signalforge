import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPECTED_ARTIFACT_TYPE,
  defaultCapabilitiesForArtifactType,
  getArtifactTypeLabel,
  getSourceTypeLabel,
  isSourceType,
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
  });

  it("provides stable labels for the current source and artifact families", () => {
    expect(getSourceTypeLabel("linux_host")).toBe("Linux host");
    expect(getSourceTypeLabel("wsl")).toBe("WSL");
    expect(getArtifactTypeLabel("linux-audit-log")).toBe("Linux audit log");
    expect(getArtifactTypeLabel("container-diagnostics")).toBe("Container diagnostics");
  });
});
