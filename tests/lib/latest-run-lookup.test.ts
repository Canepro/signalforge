import { describe, expect, it } from "vitest";
import { latestRunLookupForSource } from "@/lib/sources/latest-run-lookup";

describe("latestRunLookupForSource", () => {
  it("resolves source detail runs by target and artifact without filtering by catalog source type", () => {
    expect(
      latestRunLookupForSource({
        target_identifier: "mac:canepro-mac",
        expected_artifact_type: "mac-diagnostics",
      })
    ).toEqual({
      targetIdentifier: "mac:canepro-mac",
      artifactType: "mac-diagnostics",
    });
  });
});
