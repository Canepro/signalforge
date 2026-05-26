import {
  createOpenAIClient,
  resolveLlmConfig,
  type LlmProviderId,
  type ResolveLlmOverrides,
  type ResolvedLlmReady,
} from "./llm-provider";
import {
  resolveCodexAppServerConfig,
  type CodexAppServerResolvedConfig,
} from "./codex-app-server/config";

export type BrainProviderId = LlmProviderId | "codex_app_server";

export type ResolvedBrainReady =
  | ({ provider: "openai" | "azure" } & ResolvedLlmReady)
  | { ready: true; provider: "codex_app_server"; config: CodexAppServerResolvedConfig };

export type ResolvedBrainConfig = ResolvedBrainReady | { ready: false; reason: string };

/**
 * Resolve the configured analysis brain provider from env.
 * OpenAI and Azure use the Responses API; Codex App Server uses a local JSON-RPC session.
 */
export function resolveBrainProvider(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ResolveLlmOverrides = {}
): ResolvedBrainConfig {
  const raw = (env.LLM_PROVIDER ?? "openai").trim().toLowerCase();

  if (raw === "codex_app_server" || raw === "codex-app-server") {
    const codex = resolveCodexAppServerConfig(env, { model: overrides.model });
    if (!codex.ready) return codex;
    return { ready: true, provider: "codex_app_server", config: codex.config };
  }

  if (raw !== "openai" && raw !== "azure") {
    return {
      ready: false,
      reason: `Unknown LLM_PROVIDER "${env.LLM_PROVIDER ?? ""}". Use openai, azure, or codex_app_server.`,
    };
  }

  const llm = resolveLlmConfig(env, overrides);
  if (!llm.ready) return llm;
  return llm;
}

export { createOpenAIClient };
