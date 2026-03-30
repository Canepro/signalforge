import type { Storage } from "./contract";
import { getPostgresStorage } from "./postgres";
import { getSqliteStorage } from "./sqlite";

export type StorageDriver = "sqlite" | "postgres";

export type StorageDriverResolution = {
  raw: string;
  driver: StorageDriver;
  supported: boolean;
};

export function resolveStorageDriver(
  env: NodeJS.ProcessEnv = process.env
): StorageDriverResolution {
  const raw = (env.DATABASE_DRIVER ?? "sqlite").trim().toLowerCase() || "sqlite";
  if (raw === "postgres") {
    return { raw, driver: "postgres", supported: true };
  }
  if (raw === "sqlite") {
    return { raw, driver: "sqlite", supported: true };
  }
  return { raw, driver: "sqlite", supported: false };
}

export async function getStorage(): Promise<Storage> {
  const storageDriver = resolveStorageDriver(process.env);
  if (storageDriver.driver === "postgres") {
    return getPostgresStorage();
  }
  return getSqliteStorage();
}
