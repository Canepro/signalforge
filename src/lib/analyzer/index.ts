import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses.js";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { getAdapter, detectArtifactType } from "../adapter/registry";
import {
  AuditReportSchema,
  type AnalysisResult,
  type AuditReport,
  type EnvironmentContext,
  type Finding,
  type NoiseItem,
  type PreFinding,
} from "./schema";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { createOpenAIClient, resolveLlmConfig } from "./llm-provider";
import { auditReportResponseFormat } from "./response-format";

export interface AnalyzeOptions {
  apiKey?: string;
  model?: string;
  artifactType?: string;
  /** @internal test-only: inject an OpenAI SDK–compatible client (OpenAI or Azure-shaped base URL). */
  _openaiClient?: OpenAI;
}

function displayModelForMeta(options: AnalyzeOptions): string {
  return (
    options.model?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ||
    "gpt-5-mini"
  );
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
  const metaModel = displayModelForMeta(options);

  let client: OpenAI;
  let model: string;

  if (options._openaiClient) {
    client = options._openaiClient;
    model = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  } else {
    const resolved = resolveLlmConfig(process.env, {
      apiKey: options.apiKey,
      model: options.model,
    });
    if (!resolved.ready) {
      return buildFallbackResult(
        env,
        noise,
        preFindings,
        incomplete,
        reason,
        metaModel,
        startMs,
        resolved.reason
      );
    }
    client = createOpenAIClient(resolved);
    model = resolved.model;
  }

  try {
    const { report: llmReport, tokensUsed } = await callLlm(
      client,
      model,
      env,
      noise,
      preFindings,
      sections,
      incomplete,
      reason
    );
    const duration = Date.now() - startMs;

    const reconciledFindings = reconcileSeverity(llmReport.findings, preFindings);

    const mergedReport: AuditReport = {
      summary: llmReport.summary,
      findings: reconciledFindings,
      environment_context: env,
      noise_or_expected: noise,
      top_actions_now: llmReport.top_actions_now,
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
        tokens_used: tokensUsed,
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

  const summary = buildFallbackSummary(
    fallbackFindings,
    env,
    noise,
    incomplete,
    incompleteReason,
    error
  );
  const topActions = buildFallbackActions(fallbackFindings, env, incomplete);

  return {
    report: {
      summary,
      findings: fallbackFindings,
      environment_context: env,
      noise_or_expected: noise,
      top_actions_now: topActions,
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

function reconcileSeverity(llmFindings: Finding[], preFindings: PreFinding[]): Finding[] {
  return llmFindings.map((f) => {
    const matchByTitle = preFindings.find(
      (pf) =>
        f.title.toLowerCase().includes(pf.title.toLowerCase()) ||
        pf.title.toLowerCase().includes(f.title.toLowerCase())
    );
    const matchById = preFindings[parseInt(f.id.replace(/\D/g, ""), 10) - 1];
    const match = matchByTitle ?? matchById;

    if (match) {
      return { ...f, severity: match.severity_hint };
    }
    return f;
  });
}

const FILLER_ACTIONS = [
  "Review the full findings table and address items by severity",
  "Rerun the audit with elevated privileges if visibility was limited",
  "Collect a fresh full audit to establish a current baseline",
];

function severityWeight(severity: Finding["severity"]): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

/** When severities tie, prefer categories that usually need action first (disk/auth before loopback listeners). */
const CATEGORY_TIE_BREAK: Record<string, number> = {
  disk: 6,
  auth: 5,
  packages: 4,
  ssh: 3,
  network: 2,
  logs: 1,
};

function compareFindingsForFallback(a: Finding, b: Finding): number {
  const bySev = severityWeight(b.severity) - severityWeight(a.severity);
  if (bySev !== 0) return bySev;
  return (CATEGORY_TIE_BREAK[b.category] ?? 0) - (CATEGORY_TIE_BREAK[a.category] ?? 0);
}

function summarizeFallbackFinding(finding: Finding): string {
  if (finding.category === "disk") {
    return `${finding.title}, which leaves limited headroom for writes or package operations.`;
  }
  if (finding.category === "packages") {
    return `${finding.title}, so operating system updates remain unapplied.`;
  }
  if (finding.category === "network") {
    const t = finding.title.toLowerCase();
    if (t.includes("loopback only") || t.includes("not reachable remotely")) {
      return `${finding.title}; local-only — confirm it is expected tooling, not accidental exposure elsewhere.`;
    }
    if (t.includes("reachable on all network interfaces") || t.includes("exposed on all interfaces")) {
      return `${finding.title}; review bind address and host firewall if broad reachability is not intended.`;
    }
    return `${finding.title}, which should be reviewed to confirm the exposure matches intent.`;
  }
  if (finding.category === "logs") {
    return `${finding.title}, indicating recent service or platform errors still warrant review after noise filtering.`;
  }
  return `${finding.title}.`;
}

function buildFallbackSummary(
  findings: Finding[],
  env: EnvironmentContext,
  noise: NoiseItem[],
  incomplete: boolean,
  incompleteReason: string | undefined,
  error: string
): string[] {
  const summary = [
    `Deterministic analysis completed (LLM unavailable: ${error})`,
    `Environment: ${env.hostname} / ${env.os}${env.is_wsl ? " (WSL)" : ""}`,
  ];

  if (incomplete) {
    summary.push(`Limited visibility: ${incompleteReason}`);
  }

  if (findings.length === 0) {
    summary.push(
      `No deterministic findings were raised; ${noise.length} expected noise item(s) were suppressed`
    );
  } else {
    const highSignal = findings
      .slice()
      .sort(compareFindingsForFallback)
      .slice(0, 2)
      .map((f) => summarizeFallbackFinding(f));
    summary.push(...highSignal);
    summary.push(
      `${findings.length} finding(s) detected, ${noise.length} noise item(s) suppressed`
    );
  }

  return summary;
}

function buildActionForFinding(
  finding: Finding,
  env: EnvironmentContext
): string {
  if (finding.category === "disk") {
    const mount = finding.title.match(/: (.+?) at \d+%/)?.[1] ?? "the affected volume";
    return `Free space on ${mount} or expand the backing volume so usage drops below the warning threshold before writes start failing.`;
  }

  if (finding.category === "packages") {
    const count = finding.title.match(/^(\d+)/)?.[1];
    return `Run \`sudo apt update && sudo apt upgrade\` to apply${count ? ` the ${count} pending` : ""} package updates, then reboot if core packages change.`;
  }

  if (finding.category === "network") {
    const port = finding.title.match(/port (\d+)/)?.[1];
    const tl = finding.title.toLowerCase();
    if (tl.includes("loopback only") || tl.includes("not reachable remotely")) {
      if (tl.includes("node.js")) {
        return `Confirm the Node.js loopback listener${port ? ` on port ${port}` : ""} is expected (dev server or local tooling); stop it or change the bind if not.`;
      }
      return `Confirm the loopback-only listener${port ? ` on port ${port}` : ""} is expected local tooling, and stop it if it is no longer needed.`;
    }
    if (tl.includes("prometheus")) {
      return `Restrict the observability endpoint${port ? ` on port ${port}` : ""} to loopback, VPN, or a firewall allowlist so monitoring data is not broadly exposed.`;
    }
    if (tl.includes("http listener (web)") || tl.includes("https listener (tls)")) {
      return `If this HTTP(S) service should not be reachable from the network, restrict it with a host firewall, bind address, or front it with a reverse proxy you control.`;
    }
    if (tl.includes("reachable on all network interfaces") || tl.includes("exposed on all interfaces")) {
      return `Review why the service${port ? ` on port ${port}` : ""} is reachable on all interfaces and tighten its bind address or firewall rules if that reachability is not required.`;
    }
    if (tl.includes("unidentified listener")) {
      return `Identify the process for port ${port ?? "?"} (for example \`ss -ltnp\` / \`sudo lsof -i -P -n\`) and restrict or stop it if remote access is not intended.`;
    }
    return `Review the listener${port ? ` on port ${port}` : ""} and confirm the bound address is intentionally reachable.`;
  }

  if (finding.category === "ssh") {
    return "Harden the SSH configuration by disabling risky settings unless there is a documented operational need for them.";
  }

  if (finding.category === "auth") {
    return "Investigate the repeated authentication failures, verify whether they are expected, and block or rate-limit the source if they are not.";
  }

  if (finding.category === "logs") {
    return env.is_wsl
      ? "Review the remaining recent log errors after WSL noise filtering and fix any service failures that are still actionable."
      : "Review the remaining recent log errors and investigate the service failures that generated them.";
  }

  return finding.title;
}

function buildFallbackActions(
  findings: Finding[],
  env: EnvironmentContext,
  incomplete: boolean
): [string, string, string] {
  const fromFindings: string[] = [];
  for (const finding of findings.slice().sort(compareFindingsForFallback)) {
    const action = buildActionForFinding(finding, env);
    if (!fromFindings.includes(action)) {
      fromFindings.push(action);
    }
    if (fromFindings.length === 3) break;
  }

  if (
    incomplete &&
    !fromFindings.some((action) => action.includes("elevated privileges"))
  ) {
    fromFindings.unshift(
      "Rerun the audit with elevated privileges or collect the missing sections to restore full visibility."
    );
  }

  while (fromFindings.length < 3) {
    fromFindings.push(FILLER_ACTIONS[fromFindings.length]!);
  }
  return fromFindings.slice(0, 3) as [string, string, string];
}

interface LlmResult {
  report: AuditReport;
  tokensUsed: number;
}

function extractTokenUsage(response: Response): number {
  const usage = response.usage;
  if (!usage) return 0;
  return usage.total_tokens ?? usage.input_tokens + usage.output_tokens;
}

async function callLlm(
  client: OpenAI,
  model: string,
  env: EnvironmentContext,
  noise: NoiseItem[],
  preFindings: PreFinding[],
  sections: Record<string, string>,
  incomplete: boolean,
  incompleteReason?: string
): Promise<LlmResult> {
  const body: ResponseCreateParamsNonStreaming = {
    model,
    stream: false,
    instructions: buildSystemPrompt(),
    input: buildUserPrompt(env, noise, preFindings, sections, incomplete, incompleteReason),
    text: {
      format: auditReportResponseFormat(),
    },
  };

  const response = await client.responses.create(body);

  const tokensUsed = extractTokenUsage(response);

  const text = response.output_text;
  const parsed = JSON.parse(text);
  const report = AuditReportSchema.parse(parsed);
  return { report, tokensUsed };
}
