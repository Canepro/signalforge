import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import WebSocket from "ws";
import { auditEnrichmentJsonSchema, auditReportJsonSchema } from "../schema";
import {
  codexBrainTurnSafetyParams,
  type CodexAppServerResolvedConfig,
  type CodexAppServerStdioConfig,
  type CodexAppServerWebSocketConfig,
} from "./config";
import {
  extractAuditEnrichmentFromCodexTurnPayload,
  extractAuditReportFromCodexTurnPayload,
} from "./extract-report";
import {
  isJsonRpcResponse,
  parseJsonRpcLine,
  serializeJsonRpcLine,
  type JsonRpcWireMessage,
} from "./jsonrpc";

const CLIENT_INFO = {
  name: "signalforge_brain",
  title: "SignalForge Infrastructure Diagnostics",
  version: "1.0.0",
};

export type CodexBrainPrompt = {
  system: string;
  user: string;
};

export type CodexBrainResult = {
  report: import("../schema").AuditReport;
  tokensUsed: number;
};

export type CodexEnrichmentBrainResult = {
  enrichment: import("../schema").AuditEnrichment;
  tokensUsed: number;
};

function webSocketDataToString(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

export type CodexAppServerLineTransport = {
  writeLine: (line: string) => void;
  close: () => void;
  onLine: (handler: (line: string) => void) => void;
  onError?: (handler: (error: Error) => void) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerSession {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly turnPayloads: unknown[] = [];
  private closed = false;

  private constructor(private readonly transport: CodexAppServerLineTransport) {
    transport.onLine((line) => this.handleLine(line));
    transport.onError?.((error) => this.closeWithError(error));
  }

  static fromTransport(transport: CodexAppServerLineTransport): CodexAppServerSession {
    return new CodexAppServerSession(transport);
  }

  static async spawnStdio(config: CodexAppServerStdioConfig): Promise<CodexAppServerSession> {
    const [command, ...args] = config.command;
    if (!command) {
      throw new Error("CODEX_APP_SERVER_COMMAND must include an executable");
    }

    const child: ChildProcessWithoutNullStreams = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = createInterface({ input: child.stdout });
    let lineHandler: ((line: string) => void) | null = null;
    let errorHandler: ((error: Error) => void) | null = null;

    rl.on("line", (line) => {
      lineHandler?.(line);
    });

    child.on("error", (err) => {
      errorHandler?.(
        err instanceof Error
          ? err
          : new Error(`codex app-server process error: ${String(err)}`)
      );
    });

    child.on("exit", (code) => {
      errorHandler?.(
        new Error(`codex app-server exited with code ${code ?? "unknown"}`)
      );
    });

    const transport: CodexAppServerLineTransport = {
      writeLine: (line) => {
        child.stdin.write(line);
      },
      close: () => {
        rl.close();
        try {
          child.stdin.end();
        } catch {
          // Process may already be unavailable after spawn/stdio failures.
        }
        try {
          child.kill();
        } catch {
          // Process may already have exited.
        }
      },
      onLine: (handler) => {
        lineHandler = handler;
      },
      onError: (handler) => {
        errorHandler = handler;
      },
    };

    return new CodexAppServerSession(transport);
  }

  static async spawnWebSocket(
    config: CodexAppServerWebSocketConfig
  ): Promise<CodexAppServerSession> {
    const token =
      config.auth.kind === "bearer-token"
        ? config.auth.token.trim()
        : readFileSync(
            config.auth.kind === "capability-token"
              ? config.auth.tokenFile
              : config.auth.sharedSecretFile,
            "utf8"
          ).trim();
    if (!token) {
      throw new Error("Codex App Server WebSocket auth file is empty");
    }

    const socket = new WebSocket(config.wsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let lineHandler: ((line: string) => void) | null = null;
    let errorHandler: ((error: Error) => void) | null = null;

    socket.on("message", (data) => {
      lineHandler?.(webSocketDataToString(data));
    });
    socket.on("error", (error) => {
      errorHandler?.(error instanceof Error ? error : new Error(String(error)));
    });
    socket.on("close", (code) => {
      if (code !== 1000) {
        errorHandler?.(new Error(`codex app-server websocket closed with code ${code}`));
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Codex App Server WebSocket connection timed out")),
        10_000
      );
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    const transport: CodexAppServerLineTransport = {
      writeLine: (line) => {
        socket.send(line.trimEnd());
      },
      close: () => {
        try {
          socket.close();
        } catch {
          // Socket may already be closed after transport failures.
        }
      },
      onLine: (handler) => {
        lineHandler = handler;
      },
      onError: (handler) => {
        errorHandler = handler;
      },
    };

    return new CodexAppServerSession(transport);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex App Server session closed"));
    }
    this.pending.clear();
  }

  private closeWithError(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.turnCompleteReject?.(error);
  }

  async analyzeArtifactTurn(
    config: CodexAppServerResolvedConfig,
    prompts: CodexBrainPrompt
  ): Promise<CodexBrainResult> {
    const { output, tokensUsed } = await this.runTurn(config, prompts, auditReportJsonSchema());
    const report = extractAuditReportFromCodexTurnPayload(output);

    if (!report) {
      throw new Error("Codex App Server turn completed without a valid audit report payload");
    }

    return { report, tokensUsed };
  }

  async analyzeArtifactEnrichmentTurn(
    config: CodexAppServerResolvedConfig,
    prompts: CodexBrainPrompt
  ): Promise<CodexEnrichmentBrainResult> {
    const { output, tokensUsed } = await this.runTurn(
      config,
      prompts,
      auditEnrichmentJsonSchema()
    );
    const enrichment = extractAuditEnrichmentFromCodexTurnPayload(output);

    if (!enrichment) {
      throw new Error("Codex App Server turn completed without a valid audit enrichment payload");
    }

    return { enrichment, tokensUsed };
  }

  private async runTurn(
    config: CodexAppServerResolvedConfig,
    prompts: CodexBrainPrompt,
    schemaSpec: Record<string, unknown>
  ): Promise<{ output: unknown; tokensUsed: number }> {
    try {
      await this.request("initialize", {
        clientInfo: CLIENT_INFO,
        capabilities: {
          optOutNotificationMethods: [
            "item/agentMessage/delta",
            "command/exec/outputDelta",
            "process/outputDelta",
          ],
        },
      });

      this.notify("initialized", {});

      const threadResult = (await this.request("thread/start", {
        model: config.model,
        ephemeral: true,
        serviceName: CLIENT_INFO.name,
      })) as { thread?: { id?: string } };

      const threadId = threadResult.thread?.id;
      if (!threadId) {
        throw new Error("Codex App Server thread/start did not return a thread id");
      }

      const outputSchema = schemaSpec.schema as Record<string, unknown>;

      const turnResult = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompts.user }],
        developerInstructions: prompts.system,
        ...codexBrainTurnSafetyParams(),
        outputSchema,
      });

      this.turnPayloads.push(turnResult);
      await this.waitForTurnCompletion(config.turnTimeoutMs);

      const output = {
        turnResult,
        notifications: [...this.turnPayloads],
      };

      const tokensUsed = extractTokenUsageFromTurnPayloads(this.turnPayloads);
      return { output, tokensUsed };
    } finally {
      this.close();
    }
  }

  private notify(method: string, params: unknown): void {
    this.transport.writeLine(
      serializeJsonRpcLine({
        method,
        params,
      })
    );
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.writeLine(
        serializeJsonRpcLine({
          method,
          id,
          params,
        })
      );
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: JsonRpcWireMessage;
    try {
      message = parseJsonRpcLine(trimmed);
    } catch {
      return;
    }

    if (isJsonRpcResponse(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("method" in message && message.method) {
      this.turnPayloads.push(message);
      if (message.method === "turn/completed") {
        this.turnCompleteResolve?.();
      }
    }
  }

  private turnCompleteResolve: (() => void) | null = null;
  private turnCompleteReject: ((error: Error) => void) | null = null;

  private waitForTurnCompletion(timeoutMs = 120_000): Promise<void> {
    const alreadyCompleted = this.turnPayloads.some(
      (payload) =>
        payload &&
        typeof payload === "object" &&
        (payload as { method?: string }).method === "turn/completed"
    );
    if (alreadyCompleted) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turnCompleteResolve = null;
        this.turnCompleteReject = null;
        reject(new Error("Codex App Server turn timed out waiting for turn/completed"));
      }, timeoutMs);

      this.turnCompleteResolve = () => {
        clearTimeout(timer);
        this.turnCompleteResolve = null;
        this.turnCompleteReject = null;
        resolve();
      };
      this.turnCompleteReject = (error) => {
        clearTimeout(timer);
        this.turnCompleteResolve = null;
        this.turnCompleteReject = null;
        reject(error);
      };
    });
  }
}

function extractTokenUsageFromTurnPayloads(payloads: unknown[]): number {
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const record = payload as Record<string, unknown>;
    const params = record.params;
    if (!params || typeof params !== "object") continue;
    const usage = (params as Record<string, unknown>).usage;
    if (!usage || typeof usage !== "object") continue;
    const u = usage as Record<string, unknown>;
    const total = u.total_tokens ?? u.totalTokens;
    if (typeof total === "number") return total;
    const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
    const output = typeof u.output_tokens === "number" ? u.output_tokens : 0;
    if (input + output > 0) return input + output;
  }
  return 0;
}
