import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AuditReportSchema } from "@/lib/analyzer/schema";
import {
  codexBrainTurnSafetyParams,
  resolveCodexAppServerConfig,
} from "@/lib/analyzer/codex-app-server/config";
import { CodexAppServerSession } from "@/lib/analyzer/codex-app-server/client";
import {
  extractCodexTurnFailureMessage,
  extractAuditEnrichmentFromCodexTurnPayload,
  extractAuditReportFromCodexTurnPayload,
} from "@/lib/analyzer/codex-app-server/extract-report";
import type { AuditEnrichment, AuditReport } from "@/lib/analyzer/schema";

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

const sampleEnrichment: AuditEnrichment = {
  summary: ["Host posture needs attention."],
  top_actions_now: ["Free space on /.", "Review auth failures.", "Patch packages."],
  finding_notes: [
    {
      id: "F001",
      why_it_matters: "Low free space can cause outages.",
      recommended_action: "Free space on /.",
    },
  ],
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

  it("requires explicit opt-in before using a remote websocket URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "signalforge-codex-ws-"));
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "capability-token\n");
    try {
      const blocked = resolveCodexAppServerConfig({
        ...process.env,
        CODEX_APP_SERVER_TRANSPORT: "websocket",
        CODEX_APP_SERVER_WS_URL: "wss://codex-brain.example.com/ws",
        CODEX_APP_SERVER_WS_TOKEN_FILE: tokenFile,
      });
      expect(blocked.ready).toBe(false);
      if (!blocked.ready) expect(blocked.reason).toMatch(/ALLOW_REMOTE/i);

      const allowed = resolveCodexAppServerConfig({
        ...process.env,
        CODEX_APP_SERVER_TRANSPORT: "websocket",
        CODEX_APP_SERVER_WS_URL: "wss://codex-brain.example.com/ws",
        CODEX_APP_SERVER_WS_TOKEN_FILE: tokenFile,
        CODEX_APP_SERVER_WS_ALLOW_REMOTE: "true",
      });
      expect(allowed.ready).toBe(true);
      if (allowed.ready) expect(allowed.config.transport).toBe("websocket");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can run an analysis turn through websocket transport", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signalforge-codex-ws-"));
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "capability-token\n");
    const server = new WebSocketServer({ port: 0 });
    const requests: unknown[] = [];
    let authHeader = "";

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");

    server.on("connection", (socket, request) => {
      authHeader = request.headers.authorization ?? "";
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        requests.push(message);
        if (message.method === "initialize") {
          socket.send(JSON.stringify({ id: message.id, result: {} }));
        } else if (message.method === "thread/start") {
          socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "thread-1" } } }));
        } else if (message.method === "turn/start") {
          socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "turn-1" } } }));
          socket.send(
            JSON.stringify({
              method: "turn/completed",
              params: {
                structuredOutput: sampleReport,
                usage: { total_tokens: 99 },
              },
            })
          );
        }
      });
    });

    try {
      const config = {
        transport: "websocket" as const,
        wsUrl: `ws://127.0.0.1:${address.port}`,
        auth: { kind: "capability-token" as const, tokenFile },
        model: "gpt-5.4",
        turnTimeoutMs: 5000,
      };
      const session = await CodexAppServerSession.spawnWebSocket(config);
      const result = await session.analyzeArtifactTurn(config, {
        system: "Return JSON.",
        user: "Analyze this.",
      });

      expect(authHeader).toBe("Bearer capability-token");
      expect(result.report).toEqual(sampleReport);
      expect(result.tokensUsed).toBe(99);
      expect(requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "initialize" }),
          expect.objectContaining({ method: "thread/start" }),
          expect.objectContaining({ method: "turn/start" }),
        ])
      );
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("parses JSON embedded in final text", () => {
    const extracted = extractAuditReportFromCodexTurnPayload({
      method: "turn/completed",
      params: {
        message: `Here is the report:\n\n\`\`\`json\n${JSON.stringify(sampleReport)}\n\`\`\``,
      },
    });
    expect(extracted).toEqual(sampleReport);
  });
});

describe("extractAuditEnrichmentFromCodexTurnPayload", () => {
  it("parses compact enrichment embedded in turn/completed notifications", () => {
    const extracted = extractAuditEnrichmentFromCodexTurnPayload({
      method: "turn/completed",
      params: { structuredOutput: sampleEnrichment },
    });

    expect(extracted).toEqual(sampleEnrichment);
  });

  it("parses compact enrichment from fenced final text", () => {
    const extracted = extractAuditEnrichmentFromCodexTurnPayload({
      method: "turn/completed",
      params: {
        finalOutput: `\`\`\`json\n${JSON.stringify(sampleEnrichment)}\n\`\`\``,
      },
    });

    expect(extracted).toEqual(sampleEnrichment);
  });
});

describe("extractCodexTurnFailureMessage", () => {
  it("surfaces failed turn errors before payload parsing", () => {
    const message = extractCodexTurnFailureMessage({
      notifications: [
        {
          method: "turn/completed",
          params: {
            turn: {
              status: "failed",
              error: {
                message: "Quota exceeded. Check your plan and billing details.",
                codexErrorInfo: "usageLimitExceeded",
              },
            },
          },
        },
      ],
    });

    expect(message).toBe(
      "Quota exceeded. Check your plan and billing details. (usageLimitExceeded)"
    );
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

  it("uses Codex App Server enrichment without letting it replace deterministic findings", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");

    const result = await analyzeArtifact(raw, {
      _codexEnrichmentBrainFactory: async () => ({
        enrichment: sampleEnrichment,
        tokensUsed: 42,
        modelLabel: "codex-app-server:gpt-5.4",
      }),
    });

    expect(result.meta.llm_succeeded).toBe(true);
    expect(result.meta.model_used).toBe("codex-app-server:gpt-5.4");
    expect(result.meta.tokens_used).toBe(42);
    expect(result.report?.summary).toEqual(sampleEnrichment.summary);
    expect(result.report?.findings.map((finding) => finding.title)).not.toEqual(
      sampleReport.findings.map((finding) => finding.title)
    );
    expect(result.report?.findings[0]?.why_it_matters).toBe(sampleEnrichment.finding_notes[0]?.why_it_matters);
  });

  it("falls back when Codex returns invalid enrichment output", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-truncated.log"), "utf-8");

    const result = await analyzeArtifact(raw, {
      _codexEnrichmentBrainFactory: async () => {
        throw new Error("Codex App Server turn completed without a valid audit enrichment payload");
      },
    });

    expect(result.meta.llm_succeeded).toBe(false);
    expect(result.meta.model_used).toBe("codex-app-server:gpt-5.4");
    expect(result.analysis_error).toMatch(/valid audit enrichment/i);
    expect(result.report).not.toBeNull();
  });

  it("replaces Codex mac top_actions_now with deterministic gated recommendations on success", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    const raw = readFileSync(join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"), "utf-8");

    const result = await analyzeArtifact(raw, {
      _codexEnrichmentBrainFactory: async () => ({
        enrichment: {
          summary: ["Mocked mac posture summary"],
          top_actions_now: ["Vague cleanup action", "Check logs", "Review later"],
          finding_notes: [],
        },
        tokensUsed: 12,
        modelLabel: "codex-app-server:gpt-5.4",
      }),
    });

    expect(result.meta.llm_succeeded).toBe(true);
    const actions = result.report?.top_actions_now ?? [];
    expect(actions).not.toContain("Vague cleanup action");
    expect(actions.every((action) => /^\[(safe-immediate|review-required|authority-gated)\] /.test(action))).toBe(
      true
    );
    expect(actions.some((action) => action.toLowerCase().includes("remote-login"))).toBe(true);
  });

  it("preserves mac daily cleanup findings when Codex enrichment fails", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    const raw = readFileSync(join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"), "utf-8");

    const result = await analyzeArtifact(raw, {
      _codexEnrichmentBrainFactory: async () => {
        throw new Error("Codex App Server turn completed without a valid audit enrichment payload");
      },
    });

    const titles = result.report?.findings.map((finding) => finding.title) ?? [];
    const ruleIds = result.pre_findings.map((finding) => finding.rule_id);
    expect(result.meta.llm_succeeded).toBe(false);
    expect(ruleIds).toContain("mac.daily_cleanup_stale_review_candidates");
    expect(ruleIds).toContain("mac.daily_cleanup_prune_candidates");
    expect(titles).toContain("Daily cleanup retained 2 stale manual review candidates");
    expect(titles).toContain("Daily cleanup found one linked-worktree prune candidate");
  });

  it("falls back when Codex App Server is unavailable", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    process.env.LLM_PROVIDER = "codex_app_server";
    process.env.CODEX_APP_SERVER_TRANSPORT = "websocket";
    process.env.CODEX_APP_SERVER_WS_URL = "ws://127.0.0.1:4500";
    delete process.env.CODEX_APP_SERVER_WS_BEARER_TOKEN;
    delete process.env.CODEX_APP_SERVER_WS_TOKEN_FILE;
    delete process.env.CODEX_APP_SERVER_WS_SHARED_SECRET_FILE;
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");

    const result = await analyzeArtifact(raw);
    expect(result.meta.llm_succeeded).toBe(false);
    expect(result.analysis_error).toMatch(/WS_BEARER_TOKEN|WS_TOKEN_FILE|SHARED_SECRET_FILE/i);
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
