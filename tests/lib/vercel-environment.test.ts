import { describe, expect, it } from "vitest";
import {
  isVercelDeployment,
  shouldEnableOperatorLiveRefresh,
} from "@/lib/runtime/vercel-environment";

describe("vercel-environment", () => {
  it("treats all Vercel-hosted runtimes as review-only", () => {
    const env = {
      ...process.env,
      VERCEL: "1",
      VERCEL_ENV: "preview",
    } satisfies NodeJS.ProcessEnv;

    expect(isVercelDeployment(env)).toBe(true);
    expect(shouldEnableOperatorLiveRefresh(env)).toBe(false);
  });

  it("disables operator live refresh for any Vercel environment", () => {
    expect(
      shouldEnableOperatorLiveRefresh({
        ...process.env,
        VERCEL: "1",
        VERCEL_ENV: "production",
      } satisfies NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("keeps operator live refresh enabled off Vercel", () => {
    expect(
      shouldEnableOperatorLiveRefresh({
        ...process.env,
        VERCEL: undefined,
        VERCEL_ENV: undefined,
      } satisfies NodeJS.ProcessEnv)
    ).toBe(true);
  });
});
