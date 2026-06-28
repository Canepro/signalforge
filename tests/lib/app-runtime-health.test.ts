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

  it("reports Codex App Server brain provider metadata without checking secrets", () => {
    const report = getAppRuntimeHealthReport(
      {
        ...process.env,
        DATABASE_DRIVER: "sqlite",
        LLM_PROVIDER: "codex_app_server",
        CODEX_APP_SERVER_TRANSPORT: "stdio",
        CODEX_APP_SERVER_MODEL: "gpt-5.4",
        CODEX_APP_SERVER_TURN_TIMEOUT_MS: "45000",
      } satisfies NodeJS.ProcessEnv
    );

    expect(report.llm).toEqual({
      provider: "codex_app_server",
      status: "configured",
      model: "gpt-5.4",
      transport: "stdio",
      turn_timeout_ms: 45000,
    });
  });

  it("reports build metadata when the deployment stamps it", () => {
    const report = getAppRuntimeHealthReport(
      {
        ...process.env,
        DATABASE_DRIVER: "sqlite",
        SIGNALFORGE_BUILD_SHA: "0123456789abcdef",
        SIGNALFORGE_IMAGE: "ghcr.io/canepro/signalforge:0123456789abcdef",
        SIGNALFORGE_REVISION_SUFFIX: "sha0123456789ab",
      } satisfies NodeJS.ProcessEnv
    );

    expect(report.build).toEqual({
      revision: "0123456789abcdef",
      image: "ghcr.io/canepro/signalforge:0123456789abcdef",
      revision_suffix: "sha0123456789ab",
    });
  });
});
