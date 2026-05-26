import { describe, expect, it } from "vitest";
import {
  buildCompareApiPath,
  buildCompareExportFilename,
} from "@/lib/compare/export-compare";

describe("compare export helpers", () => {
  it("builds a baseline-vs-current export filename", () => {
    expect(
      buildCompareExportFilename(
        "kubernetes-payments-bundle.json",
        "kubernetes-payments-bundle-prev.json"
      )
    ).toBe("kubernetes-payments-bundle-prev-vs-kubernetes-payments-bundle-compare.json");
  });

  it("builds a single-run compare filename when no baseline is selected", () => {
    expect(buildCompareExportFilename("wsl-mar2026-full.log")).toBe(
      "wsl-mar2026-full-compare.json"
    );
  });

  it("builds compare API paths with optional against query", () => {
    expect(buildCompareApiPath("run-a")).toBe("/api/runs/run-a/compare");
    expect(buildCompareApiPath("run-a", "run-b")).toBe(
      "/api/runs/run-a/compare?against=run-b"
    );
  });
});
