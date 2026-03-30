import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("reports ready for the default sqlite boot path and deterministic LLM fallback", async () => {
    delete process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_PATH;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      service: "signalforge",
      storage: {
        driver: "sqlite",
        status: "ok",
        missing: [],
      },
      llm: {
        provider: "openai",
        status: "fallback",
      },
      admin_api: {
        status: "disabled",
      },
    });
  });

  it("returns 503 when postgres is selected without DATABASE_URL", async () => {
    process.env.DATABASE_DRIVER = "postgres";
    delete process.env.DATABASE_URL;

    const res = await GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      storage: {
        driver: "postgres",
        status: "error",
        missing: ["DATABASE_URL"],
      },
    });
  });

  it("reports configured Azure LLM settings and enabled admin API when present", async () => {
    process.env.DATABASE_DRIVER = "postgres";
    process.env.DATABASE_URL = "postgres://user:password@db:5432/signalforge";
    process.env.LLM_PROVIDER = "azure";
    process.env.AZURE_OPENAI_ENDPOINT = "https://signalforge.openai.azure.com/openai/v1/";
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-5.4-mini";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "  admin-secret  ";

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      storage: {
        driver: "postgres",
        status: "ok",
        missing: [],
      },
      llm: {
        provider: "azure",
        status: "configured",
      },
      admin_api: {
        status: "enabled",
      },
    });
  });
});
