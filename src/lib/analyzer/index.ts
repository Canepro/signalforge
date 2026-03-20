import OpenAI from "openai";
import { getAdapter, detectArtifactType } from "../adapter/registry.js";
import {
  AuditReportSchema,
  auditReportJsonSchema,
  type AnalysisResult,
  type AuditReport,
  type EnvironmentContext,
  type NoiseItem,
  type PreFinding,
} from "./schema.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";

export interface AnalyzeOptions {
  apiKey?: string;
  model?: string;
  artifactType?: string;
}

export async function analyzeArtifact(
  content: string,
  options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const artifactType = options.artifactType ?? detectArtifactType(content);
  const adapter = getAdapter(artifactType);

  const clean = adapter.stripNoise(content);
  const sections = adapter.parseSections(clean);
  const env = adapter.detectEnvironment(sections);
  const noise = adapter.classifyNoise(sections, env);
  const preFindings = adapter.extractPreFindings(sections, env);
  const { incomplete, reason } = adapter.detectIncomplete(sections);

  const startMs = Date.now();
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildFallbackResult(env, noise, preFindings, incomplete, reason, model, startMs, "OPENAI_API_KEY not set");
  }

  try {
    const report = await callLlm(apiKey, model, env, noise, preFindings, sections, incomplete, reason);
    const duration = Date.now() - startMs;

    const mergedReport: AuditReport = {
      ...report,
      environment_context: env,
      noise_or_expected: noise,
    };

    return {
      report: mergedReport,
      environment: env,
      noise,
      pre_findings: preFindings,
      is_incomplete: incomplete,
      incomplete_reason: reason,
      meta: {
        model_used: model,
        tokens_used: 0,
        duration_ms: duration,
        llm_succeeded: true,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildFallbackResult(env, noise, preFindings, incomplete, reason, model, startMs, message);
  }
}

function buildFallbackResult(
  env: EnvironmentContext,
  noise: NoiseItem[],
  preFindings: PreFinding[],
  incomplete: boolean,
  incompleteReason: string | undefined,
  model: string,
  startMs: number,
  error: string
): AnalysisResult {
  const fallbackFindings = preFindings.map((pf, i) => ({
    id: `F${String(i + 1).padStart(3, "0")}`,
    title: pf.title,
    severity: pf.severity_hint,
    category: pf.category,
    section_source: pf.section_source,
    evidence: pf.evidence,
    why_it_matters: "(LLM explanation unavailable)",
    recommended_action: "(LLM recommendation unavailable)",
  }));

  const summary = [
    `Deterministic analysis completed (LLM unavailable: ${error})`,
    `Environment: ${env.hostname} / ${env.os}${env.is_wsl ? " (WSL)" : ""}`,
    `${preFindings.length} finding(s) detected, ${noise.length} noise item(s) suppressed`,
  ];
  if (incomplete) {
    summary.push(`WARNING: ${incompleteReason}`);
  }

  return {
    report: {
      summary,
      findings: fallbackFindings,
      environment_context: env,
      noise_or_expected: noise,
      top_actions_now: fallbackFindings
        .slice(0, 3)
        .map((f) => f.title),
    },
    environment: env,
    noise,
    pre_findings: preFindings,
    is_incomplete: incomplete,
    incomplete_reason: incompleteReason,
    analysis_error: error,
    meta: {
      model_used: model,
      tokens_used: 0,
      duration_ms: Date.now() - startMs,
      llm_succeeded: false,
    },
  };
}

async function callLlm(
  apiKey: string,
  model: string,
  env: EnvironmentContext,
  noise: NoiseItem[],
  preFindings: PreFinding[],
  sections: Record<string, string>,
  incomplete: boolean,
  incompleteReason?: string
): Promise<AuditReport> {
  const client = new OpenAI({ apiKey });

  const response = await client.responses.create({
    model,
    instructions: buildSystemPrompt(),
    input: buildUserPrompt(env, noise, preFindings, sections, incomplete, incompleteReason),
    text: {
      format: {
        type: "json_schema",
        ...auditReportJsonSchema(),
      },
    },
  });

  const text = response.output_text;
  const parsed = JSON.parse(text);
  return AuditReportSchema.parse(parsed);
}
