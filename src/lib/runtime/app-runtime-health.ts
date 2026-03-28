import { getAdminTokenFromEnv } from "@/lib/api/admin-auth";
import { resolveLlmConfig, type LlmProviderId } from "@/lib/analyzer/llm-provider";

type StorageHealth = {
  driver: string;
  status: "ok" | "error";
  missing: string[];
  reason?: string;
};

type LlmHealth = {
  provider: LlmProviderId | string;
  status: "configured" | "fallback";
  reason?: string;
};

type AdminApiHealth = {
  status: "enabled" | "disabled";
};

export type AppRuntimeHealthReport = {
  ok: boolean;
  service: "signalforge";
  storage: StorageHealth;
  llm: LlmHealth;
  admin_api: AdminApiHealth;
};

function resolveStorageHealth(env: NodeJS.ProcessEnv): StorageHealth {
  const rawDriver = (env.DATABASE_DRIVER ?? "sqlite").trim().toLowerCase() || "sqlite";

  if (rawDriver !== "sqlite" && rawDriver !== "postgres") {
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
    | LlmProviderId
    | string;
  const resolved = resolveLlmConfig(env);

  if (resolved.ready) {
    return {
      provider: resolved.provider,
      status: "configured",
    };
  }

  return {
    provider,
    status: "fallback",
    reason: resolved.reason,
  };
}

function resolveAdminApiHealth(): AdminApiHealth {
  return {
    status: getAdminTokenFromEnv() ? "enabled" : "disabled",
  };
}

export function getAppRuntimeHealthReport(
  env: NodeJS.ProcessEnv = process.env
): AppRuntimeHealthReport {
  const storage = resolveStorageHealth(env);
  const llm = resolveLlmHealth(env);
  const admin_api = resolveAdminApiHealth();

  return {
    ok: storage.status === "ok",
    service: "signalforge",
    storage,
    llm,
    admin_api,
  };
}
