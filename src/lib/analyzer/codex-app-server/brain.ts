import type { AuditReport } from "../schema";
import { resolveCodexAppServerConfig, type CodexAppServerResolvedConfig } from "./config";
import { CodexAppServerSession, type CodexBrainPrompt } from "./client";
import type { AuditEnrichment } from "../schema";

export type CodexBrainCallResult = {
  report: AuditReport;
  tokensUsed: number;
  modelLabel: string;
};

export type CodexEnrichmentBrainCallResult = {
  enrichment: AuditEnrichment;
  tokensUsed: number;
  modelLabel: string;
};

export type CodexBrainCallOptions = {
  model?: string;
  /** @internal test-only */
  _sessionFactory?: (
    config: CodexAppServerResolvedConfig,
    prompts: CodexBrainPrompt
  ) => Promise<CodexBrainCallResult>;
};

export function modelLabelForCodexConfig(config: CodexAppServerResolvedConfig): string {
  return `codex-app-server:${config.model}`;
}

export function resolveCodexBrainReady(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { model?: string } = {}
): { ready: true; config: CodexAppServerResolvedConfig } | { ready: false; reason: string } {
  return resolveCodexAppServerConfig(env, overrides);
}

export async function callCodexAppServerBrain(
  prompts: CodexBrainPrompt,
  options: CodexBrainCallOptions = {}
): Promise<CodexBrainCallResult> {
  const resolved = resolveCodexAppServerConfig(process.env, { model: options.model });
  if (!resolved.ready) {
    throw new Error(resolved.reason);
  }

  if (options._sessionFactory) {
    return options._sessionFactory(resolved.config, prompts);
  }

  if (resolved.config.transport !== "stdio") {
    throw new Error(
      "Codex App Server WebSocket transport is not implemented in SignalForge yet; use CODEX_APP_SERVER_TRANSPORT=stdio."
    );
  }

  const session = await CodexAppServerSession.spawnStdio(resolved.config);
  const result = await session.analyzeArtifactTurn(resolved.config, prompts);
  return {
    report: result.report,
    tokensUsed: result.tokensUsed,
    modelLabel: modelLabelForCodexConfig(resolved.config),
  };
}

export async function callCodexAppServerEnrichmentBrain(
  prompts: CodexBrainPrompt,
  options: CodexBrainCallOptions = {}
): Promise<CodexEnrichmentBrainCallResult> {
  const resolved = resolveCodexAppServerConfig(process.env, { model: options.model });
  if (!resolved.ready) {
    throw new Error(resolved.reason);
  }

  if (resolved.config.transport !== "stdio") {
    throw new Error(
      "Codex App Server WebSocket transport is not implemented in SignalForge yet; use CODEX_APP_SERVER_TRANSPORT=stdio."
    );
  }

  const session = await CodexAppServerSession.spawnStdio(resolved.config);
  const result = await session.analyzeArtifactEnrichmentTurn(resolved.config, prompts);
  return {
    enrichment: result.enrichment,
    tokensUsed: result.tokensUsed,
    modelLabel: modelLabelForCodexConfig(resolved.config),
  };
}
