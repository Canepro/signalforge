import { describe, it, expect, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";
import {
  resolveLlmConfig,
  createOpenAIClient,
  detectAzureEndpointStyle,
} from "@/lib/analyzer/llm-provider";

describe("llm-provider", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("defaults to openai and requires OPENAI_API_KEY", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const r = resolveLlmConfig(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toContain("OPENAI_API_KEY");
  });

  it("resolves openai with model default", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_MODEL;
    const r = resolveLlmConfig(process.env);
    expect(r).toEqual({
      ready: true,
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-5-mini",
    });
  });

  it("openai: overrides apply", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-env";
    process.env.OPENAI_MODEL = "gpt-env";
    const r = resolveLlmConfig(process.env, { apiKey: "sk-override", model: "gpt-override" });
    expect(r).toEqual({
      ready: true,
      provider: "openai",
      apiKey: "sk-override",
      model: "gpt-override",
    });
  });

  it("azure legacy: fails closed when API version missing", () => {
    process.env.LLM_PROVIDER = "azure";
    process.env.AZURE_OPENAI_ENDPOINT = "https://x.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "k";
    process.env.AZURE_OPENAI_DEPLOYMENT = "dep";
    delete process.env.AZURE_OPENAI_API_VERSION;
    const r = resolveLlmConfig(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.reason).toMatch(/legacy/i);
      expect(r.reason).toMatch(/AZURE_OPENAI_API_VERSION|API version/i);
    }
  });

  it("azure openai_v1: ready without API version", () => {
    process.env.LLM_PROVIDER = "azure";
    process.env.AZURE_OPENAI_ENDPOINT = "https://Signalforge-resource.openai.azure.com/openai/v1/";
    process.env.AZURE_OPENAI_API_KEY = "k";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-5.4-mini";
    delete process.env.AZURE_OPENAI_API_VERSION;
    const r = resolveLlmConfig(process.env);
    expect(r).toMatchObject({
      ready: true,
      provider: "azure",
      model: "gpt-5.4-mini",
      endpointStyle: "openai_v1",
      apiVersion: null,
    });
  });

  it("azure openai_v1: API version in env is stored but not sent on the wire (v1 bases reject api-version)", () => {
    process.env.LLM_PROVIDER = "azure";
    process.env.AZURE_OPENAI_ENDPOINT = "https://res.openai.azure.com/openai/v1";
    process.env.AZURE_OPENAI_API_KEY = "k";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-5.4-mini";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    const r = resolveLlmConfig(process.env);
    expect(r).toMatchObject({
      ready: true,
      endpointStyle: "openai_v1",
      apiVersion: "2025-04-01-preview",
    });
  });

  it("azure legacy: resolves with API version", () => {
    process.env.LLM_PROVIDER = "azure";
    process.env.AZURE_OPENAI_ENDPOINT = "https://pipelinehealerdev-openai-zarrajklt3i5u.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-5.1-codex-mini";
    const r = resolveLlmConfig(process.env);
    expect(r).toMatchObject({
      ready: true,
      provider: "azure",
      model: "gpt-5.1-codex-mini",
      apiKey: "azure-key",
      endpointStyle: "legacy",
      apiVersion: "2025-04-01-preview",
    });
  });

  it("azure: fails when deployment missing", () => {
    process.env.LLM_PROVIDER = "azure";
    process.env.AZURE_OPENAI_ENDPOINT = "https://x.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "k";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    delete process.env.AZURE_OPENAI_DEPLOYMENT;
    const r = resolveLlmConfig(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toMatch(/incomplete/i);
  });

  it("createOpenAIClient builds legacy Azure base URL with /openai", () => {
    const cfg = {
      ready: true as const,
      provider: "azure" as const,
      apiKey: "k",
      model: "my-dep",
      endpoint: "https://res.cognitiveservices.azure.com/",
      endpointStyle: "legacy" as const,
      apiVersion: "2025-04-01-preview",
    };
    const client = createOpenAIClient(cfg);
    expect(client).toBeInstanceOf(OpenAI);
    expect(client.baseURL).toBe("https://res.cognitiveservices.azure.com/openai");
  });

  it("createOpenAIClient uses v1 base URL as-is (no extra /openai)", () => {
    const cfg = {
      ready: true as const,
      provider: "azure" as const,
      apiKey: "k",
      model: "gpt-5.4-mini",
      endpoint: "https://Signalforge-resource.openai.azure.com/openai/v1/",
      endpointStyle: "openai_v1" as const,
      apiVersion: null,
    };
    const client = createOpenAIClient(cfg);
    expect(client.baseURL).toBe("https://Signalforge-resource.openai.azure.com/openai/v1");
    expect(client["_options"]?.defaultQuery ?? {}).toEqual({});
  });

  it("createOpenAIClient v1 never sends api-version (Azure v1 rejects it)", () => {
    const cfg = {
      ready: true as const,
      provider: "azure" as const,
      apiKey: "k",
      model: "gpt-5.4-mini",
      endpoint: "https://res.openai.azure.com/openai/v1/",
      endpointStyle: "openai_v1" as const,
      apiVersion: "2025-04-01-preview",
    };
    const client = createOpenAIClient(cfg);
    expect(client.baseURL).toBe("https://res.openai.azure.com/openai/v1");
    expect(
      (client as unknown as { _options: { defaultQuery?: Record<string, string> } })._options.defaultQuery ?? {}
    ).toEqual({});
  });

  it("legacy openai.azure.com host without /openai/v1 path still uses /openai suffix", () => {
    const cfg = {
      ready: true as const,
      provider: "azure" as const,
      apiKey: "k",
      model: "gpt-5.1-codex-mini",
      endpoint: "https://myres.openai.azure.com",
      endpointStyle: "legacy" as const,
      apiVersion: "2025-04-01-preview",
    };
    const client = createOpenAIClient(cfg);
    expect(client.baseURL).not.toContain("deployments");
    expect(client.baseURL).toBe("https://myres.openai.azure.com/openai");
  });

  it("rejects unknown LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.OPENAI_API_KEY = "x";
    const r = resolveLlmConfig(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toMatch(/Unknown LLM_PROVIDER/i);
  });
});

describe("detectAzureEndpointStyle", () => {
  it("classifies cognitiveservices root as legacy", () => {
    expect(detectAzureEndpointStyle("https://r.cognitiveservices.azure.com")).toBe("legacy");
  });

  it("classifies openai.azure.com root as legacy", () => {
    expect(detectAzureEndpointStyle("https://r.openai.azure.com")).toBe("legacy");
  });

  it("classifies /openai/v1 base as openai_v1", () => {
    expect(detectAzureEndpointStyle("https://Signalforge-resource.openai.azure.com/openai/v1/")).toBe(
      "openai_v1"
    );
    expect(detectAzureEndpointStyle("https://x.openai.azure.com/openai/v1")).toBe("openai_v1");
  });

  it("classifies longer v1 paths as openai_v1", () => {
    expect(detectAzureEndpointStyle("https://x.openai.azure.com/openai/v1/foo")).toBe("openai_v1");
  });
});
