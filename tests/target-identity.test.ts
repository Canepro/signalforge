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
});
