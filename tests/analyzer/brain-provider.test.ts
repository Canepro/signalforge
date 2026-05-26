import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBrainProvider } from "@/lib/analyzer/brain-provider";
import { resolveLlmConfig } from "@/lib/analyzer/llm-provider";

describe("brain-provider", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("resolves codex_app_server stdio by default", () => {
    process.env.LLM_PROVIDER = "codex_app_server";
    const r = resolveBrainProvider(process.env);
    expect(r).toMatchObject({
      ready: true,
      provider: "codex_app_server",
      config: {
        transport: "stdio",
        command: ["codex", "app-server"],
        model: "gpt-5.4",
      },
    });
  });

  it("codex_app_server websocket requires loopback URL and auth file", () => {
    process.env.LLM_PROVIDER = "codex_app_server";
    process.env.CODEX_APP_SERVER_TRANSPORT = "websocket";
    process.env.CODEX_APP_SERVER_WS_URL = "ws://127.0.0.1:4500";
    delete process.env.CODEX_APP_SERVER_WS_TOKEN_FILE;
    delete process.env.CODEX_APP_SERVER_WS_SHARED_SECRET_FILE;
    const r = resolveBrainProvider(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.reason).toMatch(/WS_TOKEN_FILE|SHARED_SECRET_FILE/i);
    }
  });

  it("rejects non-loopback websocket URL", () => {
    process.env.LLM_PROVIDER = "codex_app_server";
    process.env.CODEX_APP_SERVER_TRANSPORT = "websocket";
    process.env.CODEX_APP_SERVER_WS_URL = "ws://10.0.0.5:4500";
    const r = resolveBrainProvider(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toMatch(/loopback/i);
  });

  it("openai and azure still resolve through brain-provider", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const r = resolveBrainProvider(process.env);
    expect(r).toMatchObject({ ready: true, provider: "openai", apiKey: "sk-test" });
    expect(resolveLlmConfig(process.env)).toEqual(r);
  });

  it("unknown LLM_PROVIDER mentions codex_app_server", () => {
    process.env.LLM_PROVIDER = "anthropic";
    const r = resolveBrainProvider(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toMatch(/codex_app_server/i);
  });
});
