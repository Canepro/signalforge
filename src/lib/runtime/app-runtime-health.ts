import { getAdminTokenFromEnv } from "@/lib/api/admin-auth";
import { resolveBrainProvider, type BrainProviderId } from "@/lib/analyzer/brain-provider";
import { resolveStorageDriver } from "@/lib/storage";

type StorageHealth = {
  driver: string;
  status: "ok" | "error";
  missing: string[];
  reason?: string;
};

type LlmHealth = {
  provider: BrainProviderId | string;
  status: "configured" | "fallback";
  reason?: string;
  model?: string;
  transport?: string;
  turn_timeout_ms?: number;
};

type AdminApiHealth = {
  status: "enabled" | "disabled";
};

type BuildHealth = {
  revision: string | null;
  image: string | null;
  revision_suffix: string | null;
};

export type AppRuntimeHealthReport = {
  ok: boolean;
  service: "signalforge";
  storage: StorageHealth;
  llm: LlmHealth;
  admin_api: AdminApiHealth;
  build: BuildHealth;
};

function resolveStorageHealth(env: NodeJS.ProcessEnv): StorageHealth {
  const storageDriver = resolveStorageDriver(env);
  const rawDriver = storageDriver.raw;

  if (!storageDriver.supported) {
    return {
      driver: rawDriver,
      status: "error",
      missing: [],
      reason: `Unsupported DATABASE_DRIVER "${env.DATABASE_DRIVER ?? ""}". Use sqlite or postgres.`,
    };
  }

  if (rawDriver === "postgres") {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      return {
        driver: "postgres",
        status: "error",
        missing: ["DATABASE_URL"],
        reason: "DATABASE_URL is required when DATABASE_DRIVER=postgres.",
      };
    }
  }

  return {
    driver: rawDriver,
    status: "ok",
    missing: [],
  };
}

function resolveLlmHealth(env: NodeJS.ProcessEnv): LlmHealth {
  const provider = ((env.LLM_PROVIDER ?? "openai").trim().toLowerCase() || "openai") as
    | BrainProviderId
    | string;
  const resolved = resolveBrainProvider(env);

  if (resolved.ready) {
    if (resolved.provider === "codex_app_server") {
      return {
        provider: resolved.provider,
        status: "configured",
        model: resolved.config.model,
        transport: resolved.config.transport,
        turn_timeout_ms: resolved.config.turnTimeoutMs,
      };
    }

    return {
      provider: resolved.provider,
      status: "configured",
      model: resolved.model,
    };
  }

  return {
    provider,
    status: "fallback",
    reason: resolved.reason,
  };
}

function resolveAdminApiHealth(env: NodeJS.ProcessEnv): AdminApiHealth {
  return {
    status: getAdminTokenFromEnv(env) ? "enabled" : "disabled",
  };
}

function presentEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unknown") return null;
  return trimmed;
}

function resolveBuildHealth(env: NodeJS.ProcessEnv): BuildHealth {
  return {
    revision:
      presentEnvValue(env.SIGNALFORGE_BUILD_SHA) ??
      presentEnvValue(env.VERCEL_GIT_COMMIT_SHA) ??
      null,
    image: presentEnvValue(env.SIGNALFORGE_IMAGE),
    revision_suffix: presentEnvValue(env.SIGNALFORGE_REVISION_SUFFIX),
  };
}

export function getAppRuntimeHealthReport(
  env: NodeJS.ProcessEnv = process.env
): AppRuntimeHealthReport {
  const storage = resolveStorageHealth(env);
  const llm = resolveLlmHealth(env);
  const admin_api = resolveAdminApiHealth(env);
  const build = resolveBuildHealth(env);

  return {
    ok: storage.status === "ok",
    service: "signalforge",
    storage,
    llm,
    admin_api,
    build,
  };
}
