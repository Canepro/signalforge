import { describe, expect, it } from "vitest";
import { getAppRuntimeHealthReport } from "@/lib/runtime/app-runtime-health";

describe("getAppRuntimeHealthReport", () => {
  it("uses the provided env snapshot when resolving admin API health", () => {
    const report = getAppRuntimeHealthReport(
      {
        ...process.env,
        DATABASE_DRIVER: "sqlite",
        SIGNALFORGE_ADMIN_TOKEN: "  admin-token  ",
      } satisfies NodeJS.ProcessEnv
    );

    expect(report.admin_api.status).toBe("enabled");
  });
});
