import { describe, expect, it } from "vitest";
import { compareRunAgainstHref, compareRunHref } from "@/lib/compare/nav";

describe("compare/nav", () => {
  it("compareRunHref", () => {
    expect(compareRunHref("abc")).toBe("/runs/abc/compare");
  });

  it("compareRunAgainstHref encodes query", () => {
    expect(compareRunAgainstHref("current-id", "baseline-id")).toBe(
      "/runs/current-id/compare?against=baseline-id"
    );
  });
});
