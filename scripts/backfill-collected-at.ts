import { Pool } from "pg";
import { getDb, saveDb, withDbFileLock } from "@/lib/db/client";
import {
  backfillMissingCollectedAtInPostgres,
  backfillMissingCollectedAtInSqlite,
} from "@/lib/ingestion/collected-at";

async function run(): Promise<void> {
  const driver = process.env.DATABASE_DRIVER === "postgres" ? "postgres" : "sqlite";

  if (driver === "postgres") {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgres");
    }

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const summary = await backfillMissingCollectedAtInPostgres(client);
        await client.query("COMMIT");
        console.log(JSON.stringify({ driver, ...summary }));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
    return;
  }

  await withDbFileLock(async () => {
    const db = await getDb();
    const summary = backfillMissingCollectedAtInSqlite(db);
    saveDb();
    console.log(JSON.stringify({ driver, ...summary }));
  });
}

await run();
