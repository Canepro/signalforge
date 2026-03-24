import type { Storage } from "./contract";
import { getPostgresStorage } from "./postgres";
import { getSqliteStorage } from "./sqlite";

export async function getStorage(): Promise<Storage> {
  if (process.env.DATABASE_DRIVER === "postgres") {
    return getPostgresStorage();
  }
  return getSqliteStorage();
}
