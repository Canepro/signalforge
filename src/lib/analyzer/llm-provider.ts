import OpenAI from "openai";

export type LlmProviderId = "openai" | "azure";

/** How we interpret `AZURE_OPENAI_ENDPOINT` for routing and query params. */
export type AzureEndpointStyle = "legacy" | "openai_v1";

export type ResolveLlmOverrides = {
  /** Overrides env API key for the active provider. */
  apiKey?: string;
  /** OpenAI: model id. Azure: deployment name (same value sent as `model` on the wire). */
  model?: string;
};

export type ResolvedLlmReady =
  | {
      ready: true;
      provider: "openai";
      apiKey: string;
      model: string;
    }
  | {
      ready: true;
      provider: "azure";
      apiKey: string;
      /** Azure deployment name — passed as `model` to the Responses API. */
      model: string;
      endpoint: string;
      endpointStyle: AzureEndpointStyle;
      /**
       * Legacy (`*.cognitiveservices.azure.com` or `*.openai.azure.com` without `/openai/v1`): required, sent as `api-version` query.
       * OpenAI v1 base URL (`.../openai/v1`): optional; included in defaultQuery only when set.
       */
      apiVersion: string | null;
    };

export type ResolvedLlmConfig = ResolvedLlmReady | { ready: false; reason: string };

/**
 * Detect Azure endpoint style from `AZURE_OPENAI_ENDPOINT`.
 *
 * - **openai_v1**: path is `/openai/v1` or starts with `/openai/v1/` — do not append `/openai`; API version optional.
 * - **legacy**: resource root (e.g. `https://res.cognitiveservices.azure.com`) — append `/openai`; API version required.
 */
export function detectAzureEndpointStyle(endpoint: string): AzureEndpointStyle {
  const trimmed = endpoint.trim();
  if (!trimmed) return "legacy";
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === "/openai/v1" || path.startsWith("/openai/v1/")) {
      return "openai_v1";
    }
  } catch {
    return "legacy";
  }
  return "legacy";
}

/**
 * Resolve LLM provider + credentials from env (and optional call-site overrides).
 * Default: `LLM_PROVIDER=openai`.
 *
 * Azure:
 * - **Legacy** endpoint: `AZURE_OPENAI_API_VERSION` is required.
 * - **`/openai/v1` base URL**: omit `AZURE_OPENAI_API_VERSION` (v1 rejects `api-version` on the wire; any env value is ignored when building the client).
 */
export function resolveLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ResolveLlmOverrides = {}
): ResolvedLlmConfig {
  const raw = (env.LLM_PROVIDER ?? "openai").trim().toLowerCase();

  if (raw !== "openai" && raw !== "azure") {
    return {
      ready: false,
      reason: `Unknown LLM_PROVIDER "${env.LLM_PROVIDER ?? ""}". Use openai or azure.`,
    };
  }

  if (raw === "openai") {
    const apiKey = (overrides.apiKey ?? env.OPENAI_API_KEY)?.trim();
    if (!apiKey) {
      return { ready: false, reason: "OPENAI_API_KEY not set" };
    }
    const model = (overrides.model ?? env.OPENAI_MODEL ?? "gpt-5-mini").trim();
    return { ready: true, provider: "openai", apiKey, model };
  }

  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = (overrides.apiKey ?? env.AZURE_OPENAI_API_KEY)?.trim();
  const apiVersionRaw = env.AZURE_OPENAI_API_VERSION?.trim();
  const deployment = (overrides.model ?? env.AZURE_OPENAI_DEPLOYMENT)?.trim();

  if (!endpoint || !apiKey || !deployment) {
    return {
      ready: false,
      reason:
        "Azure OpenAI selected (LLM_PROVIDER=azure) but configuration is incomplete. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT.",
    };
  }

  const endpointStyle = detectAzureEndpointStyle(endpoint);

  if (endpointStyle === "legacy") {
    if (!apiVersionRaw) {
      return {
        ready: false,
        reason:
          "Azure legacy endpoint: set AZURE_OPENAI_API_VERSION (e.g. 2025-04-01-preview). If your URL ends with /openai/v1, use that full base URL — API version is then optional.",
      };
    }
    return {
      ready: true,
      provider: "azure",
      apiKey,
      model: deployment,
      endpoint,
      endpointStyle: "legacy",
      apiVersion: apiVersionRaw,
    };
  }

  return {
    ready: true,
    provider: "azure",
    apiKey,
    model: deployment,
    endpoint,
    endpointStyle: "openai_v1",
    apiVersion: apiVersionRaw || null,
  };
}

/**
 * Build an OpenAI SDK client for OpenAI direct or Azure OpenAI.
 *
 * Uses `client.responses.create(...)` against:
 * - OpenAI: default platform URL
 * - Azure legacy: `{endpoint}/openai` + `api-version` query (required)
 * - Azure v1 base: `{endpoint}` as given (typically `.../openai/v1`) + optional `api-version`
 *
 * The deployment name is sent as the `model` field in the request body.
 */
export function createOpenAIClient(cfg: ResolvedLlmReady): OpenAI {
  if (cfg.provider === "openai") {
    return new OpenAI({ apiKey: cfg.apiKey });
  }

  if (cfg.endpointStyle === "openai_v1") {
    const baseURL = cfg.endpoint.replace(/\/$/, "");
    // Azure `/openai/v1/` Foundry-style bases do not use `api-version`; sending it returns 400 "API version not supported".
    return new OpenAI({
      apiKey: cfg.apiKey,
      baseURL,
      defaultHeaders: { "api-key": cfg.apiKey },
    });
  }

  const base = cfg.endpoint.replace(/\/$/, "");
  const baseURL = `${base}/openai`;

  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL,
    defaultQuery: { "api-version": cfg.apiVersion! },
    defaultHeaders: { "api-key": cfg.apiKey },
  });
}
