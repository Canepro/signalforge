import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuditReportSchema } from "@/lib/analyzer/schema";
import {
  codexBrainTurnSafetyParams,
  resolveCodexAppServerConfig,
} from "@/lib/analyzer/codex-app-server/config";
import {
  extractAuditEnrichmentFromCodexTurnPayload,
  extractAuditReportFromCodexTurnPayload,
} from "@/lib/analyzer/codex-app-server/extract-report";
import type { AuditReport } from "@/lib/analyzer/schema";

const FIXTURES = join(__dirname, "../fixtures");

const sampleReport: AuditReport = {
  summary: ["Host posture needs attention."],
  findings: [
    {
      id: "F001",
      title: "Disk usage critical: / at 94%",
      severity: "critical",
      category: "disk",
      section_source: "DISK USAGE",
      evidence: "/dev/sda1 94%",
      why_it_matters: "Low free space can cause outages.",
      recommended_action: "Free space on /.",
    },
  ],
  environment_context: {
    hostname: "host-a",
    os: "Linux",
    kernel: "6.1.0",
    is_wsl: false,
    is_container: false,
    is_virtual_machine: false,
    ran_as_root: true,
    uptime: "1 day",
  },
  noise_or_expected: [],
  top_actions_now: ["Free space on /.", "Review auth failures.", "Patch packages."],
};

describe("codex app-server config", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("defaults to stdio codex app-server command", () => {
    const r = resolveCodexAppServerConfig({
      ...process.env,
      CODEX_APP_SERVER_TRANSPORT: "stdio",
    });
    expect(r.ready).toBe(true);
    if (r.ready) {
        expect(r.config.transport).toBe("stdio");
        if (r.config.transport === "stdio") {
          expect(r.config.command).toEqual(["codex", "app-server"]);
          expect(r.config.turnTimeoutMs).toBe(120000);
        }
      }
    });
  });

  it("honors CODEX_APP_SERVER_TURN_TIMEOUT_MS", () => {
    const r = resolveCodexAppServerConfig({
      ...process.env,
      CODEX_APP_SERVER_TRANSPORT: "stdio",
      CODEX_APP_SERVER_TURN_TIMEOUT_MS: "30000",
    });
    expect(r.ready).toBe(true);
    if (r.ready) expect(r.config.turnTimeoutMs).toBe(30000);
  });

describe("extractAuditReportFromCodexTurnPayload", () => {
  it("parses structured output embedded in turn/completed notifications", () => {
    const extracted = extractAuditReportFromCodexTurnPayload({
      method: "turn/completed",
      params: { structuredOutput: sampleReport },
    });
    expect(extracted).toEqual(sampleReport);
    expect(AuditReportSchema.safeParse(extracted).success).toBe(true);
  });

  it("parses the Codex protocol structuredContent field", () => {
    const extracted = extractAuditReportFromCodexTurnPayload({
      method: "turn/completed",
      params: { turn: { structuredContent: sampleReport } },
    });
    expect(extracted).toEqual(sampleReport);
  });
});

describe("extractAuditEnrichmentFromCodexTurnPayload", () => {
  it("parses compact enrichment embedded in turn/completed notifications", () => {
    const enrichment = {
      summary: ["Large cluster run needs exposure review."],
      top_actions_now: ["Action A", "Action B", "Action C"],
      finding_notes: [
        {
          id: "F001",
          why_it_matters: "Public exposure expands the cluster attack surface.",
          recommended_action: "Make the Service internal unless public access is required.",
        },
      ],
    };

    const extracted = extractAuditEnrichmentFromCodexTurnPayload({
      method: "turn/completed",
      params: { structuredOutput: enrichment },
    });

    expect(extracted).toEqual(enrichment);
  });
});

describe("codex brain turn safety", () => {
  it("uses read-only sandbox with network disabled and no approvals", () => {
    expect(codexBrainTurnSafetyParams()).toEqual({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
  });
});

describe("analyzeArtifact with codex_app_server", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("parses a successful Codex brain response", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");

    const result = await analyzeArtifact(raw, {
      _codexBrainFactory: async () => ({
        report: sampleReport,
        tokensUsed: 42,
        modelLabel: "codex-app-server:gpt-5.4",
      }),
    });

    expect(result.meta.llm_succeeded).toBe(true);
    expect(result.meta.model_used).toBe("codex-app-server:gpt-5.4");
    expect(result.meta.tokens_used).toBe(42);
    expect(result.report?.summary).toEqual(sampleReport.summary);
  });

  it("falls back when Codex returns invalid JSON output", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-truncated.log"), "utf-8");

    const result = await analyzeArtifact(raw, {
      _codexBrainFactory: async () => {
        throw new Error("Codex App Server turn completed without a valid audit report payload");
      },
    });

    expect(result.meta.llm_succeeded).toBe(false);
    expect(result.meta.model_used).toBe("codex-app-server:gpt-5.4");
    expect(result.analysis_error).toMatch(/valid audit report/i);
    expect(result.report).not.toBeNull();
  });

  it("falls back when Codex App Server is unavailable", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    process.env.CODEX_APP_SERVER_TRANSPORT = "websocket";
    process.env.CODEX_APP_SERVER_WS_URL = "ws://127.0.0.1:4500";
    delete process.env.CODEX_APP_SERVER_WS_TOKEN_FILE;
    delete process.env.CODEX_APP_SERVER_WS_SHARED_SECRET_FILE;
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");

    const result = await analyzeArtifact(raw);
    expect(result.meta.llm_succeeded).toBe(false);
    expect(result.analysis_error).toMatch(/WS_TOKEN_FILE|SHARED_SECRET_FILE/i);
  });

  it("falls back when the stdio command cannot be spawned", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    process.env.CODEX_APP_SERVER_TRANSPORT = "stdio";
    process.env.CODEX_APP_SERVER_COMMAND = "/definitely/missing-codex-app-server";
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-truncated.log"), "utf-8");

    const result = await analyzeArtifact(raw);

    expect(result.meta.llm_succeeded).toBe(false);
    expect(result.meta.model_used).toBe("codex-app-server:gpt-5.4");
    expect(result.analysis_error).toMatch(/missing-codex-app-server|ENOENT/i);
    expect(result.report).not.toBeNull();
  });

  it("does not change OpenAI provider resolution", async () => {
    const { resolveBrainProvider } = await import("@/lib/analyzer/brain-provider");
    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    const r = resolveBrainProvider(process.env);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toContain("OPENAI_API_KEY");
  });
});
