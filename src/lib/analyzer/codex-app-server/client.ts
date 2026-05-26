import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { auditReportJsonSchema } from "../schema";
import {
  codexBrainTurnSafetyParams,
  type CodexAppServerResolvedConfig,
  type CodexAppServerStdioConfig,
} from "./config";
import { extractAuditReportFromCodexTurnPayload } from "./extract-report";
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

export type CodexAppServerLineTransport = {
  writeLine: (line: string) => void;
  close: () => void;
  onLine: (handler: (line: string) => void) => void;
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

    rl.on("line", (line) => {
      lineHandler?.(line);
    });

    child.on("exit", (code) => {
      if (!lineHandler) return;
      lineHandler(
        JSON.stringify({
          id: -1,
          error: {
            code: -32000,
            message: `codex app-server exited with code ${code ?? "unknown"}`,
          },
        })
      );
    });

    const transport: CodexAppServerLineTransport = {
      writeLine: (line) => {
        child.stdin.write(line);
      },
      close: () => {
        rl.close();
        child.stdin.end();
        child.kill();
      },
      onLine: (handler) => {
        lineHandler = handler;
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

  async analyzeArtifactTurn(
    config: CodexAppServerResolvedConfig,
    prompts: CodexBrainPrompt
  ): Promise<CodexBrainResult> {
    if (config.transport === "websocket") {
      throw new Error(
        "Codex App Server WebSocket transport is not implemented in SignalForge yet; use CODEX_APP_SERVER_TRANSPORT=stdio."
      );
    }

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

      const schemaSpec = auditReportJsonSchema();
      const outputSchema = schemaSpec.schema as Record<string, unknown>;

      const turnResult = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompts.user }],
        developerInstructions: prompts.system,
        ...codexBrainTurnSafetyParams(),
        outputSchema,
      });

      this.turnPayloads.push(turnResult);
      await this.waitForTurnCompletion();

      const report = extractAuditReportFromCodexTurnPayload({
        turnResult,
        notifications: [...this.turnPayloads],
      });

      if (!report) {
        throw new Error("Codex App Server turn completed without a valid audit report payload");
      }

      const tokensUsed = extractTokenUsageFromTurnPayloads(this.turnPayloads);
      return { report, tokensUsed };
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
        reject(new Error("Codex App Server turn timed out waiting for turn/completed"));
      }, timeoutMs);

      this.turnCompleteResolve = () => {
        clearTimeout(timer);
        this.turnCompleteResolve = null;
        resolve();
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
