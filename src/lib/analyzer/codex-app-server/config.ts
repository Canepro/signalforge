import { readFileSync } from "node:fs";

export type CodexAppServerTransportKind = "stdio" | "websocket";

export type CodexAppServerStdioConfig = {
  transport: "stdio";
  /** argv for the app-server process (e.g. `codex`, `app-server`). */
  command: string[];
  model: string;
};

export type CodexAppServerWebSocketConfig = {
  transport: "websocket";
  wsUrl: string;
  auth:
    | { kind: "capability-token"; tokenFile: string }
    | { kind: "signed-bearer"; sharedSecretFile: string };
  model: string;
};

export type CodexAppServerResolvedConfig =
  | CodexAppServerStdioConfig
  | CodexAppServerWebSocketConfig;

export type ResolveCodexAppServerResult =
  | { ready: true; config: CodexAppServerResolvedConfig }
  | { ready: false; reason: string };

const DEFAULT_COMMAND = "codex app-server";
const DEFAULT_MODEL = "gpt-5.4";

function parseCommand(commandEnv: string | undefined): string[] {
  const raw = commandEnv?.trim() || DEFAULT_COMMAND;
  return raw.split(/\s+/).filter(Boolean);
}

function isLoopbackWebSocketUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve Codex App Server transport settings from env.
 * WebSocket is opt-in and requires explicit auth file configuration on loopback only.
 */
export function resolveCodexAppServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { model?: string } = {}
): ResolveCodexAppServerResult {
  const transport = (env.CODEX_APP_SERVER_TRANSPORT ?? "stdio").trim().toLowerCase();
  const model = (overrides.model ?? env.CODEX_APP_SERVER_MODEL ?? DEFAULT_MODEL).trim();

  if (transport === "stdio" || transport === "") {
    return {
      ready: true,
      config: {
        transport: "stdio",
        command: parseCommand(env.CODEX_APP_SERVER_COMMAND),
        model,
      },
    };
  }

  if (transport !== "websocket") {
    return {
      ready: false,
      reason: `Unknown CODEX_APP_SERVER_TRANSPORT "${transport}". Use stdio or websocket.`,
    };
  }

  const wsUrl = env.CODEX_APP_SERVER_WS_URL?.trim();
  if (!wsUrl) {
    return {
      ready: false,
      reason:
        "CODEX_APP_SERVER_TRANSPORT=websocket requires CODEX_APP_SERVER_WS_URL (loopback only until auth is configured).",
    };
  }

  if (!isLoopbackWebSocketUrl(wsUrl)) {
    return {
      ready: false,
      reason:
        "CODEX_APP_SERVER_WS_URL must be loopback (127.0.0.1, localhost, or ::1). Non-loopback WebSocket listeners are not enabled.",
    };
  }

  const tokenFile = env.CODEX_APP_SERVER_WS_TOKEN_FILE?.trim();
  const sharedSecretFile = env.CODEX_APP_SERVER_WS_SHARED_SECRET_FILE?.trim();

  if (tokenFile && fileExists(tokenFile)) {
    return {
      ready: true,
      config: {
        transport: "websocket",
        wsUrl,
        auth: { kind: "capability-token", tokenFile },
        model,
      },
    };
  }

  if (sharedSecretFile && fileExists(sharedSecretFile)) {
    return {
      ready: true,
      config: {
        transport: "websocket",
        wsUrl,
        auth: { kind: "signed-bearer", sharedSecretFile },
        model,
      },
    };
  }

  return {
    ready: false,
    reason:
      "CODEX_APP_SERVER_TRANSPORT=websocket requires CODEX_APP_SERVER_WS_TOKEN_FILE or CODEX_APP_SERVER_WS_SHARED_SECRET_FILE pointing at readable secret files.",
  };
}

/** Sandbox + approval settings for SignalForge analysis turns (no shell/file mutation). */
export function codexBrainTurnSafetyParams(): {
  approvalPolicy: "never";
  sandboxPolicy: { type: "readOnly" };
} {
  return {
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
  };
}
