import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

interface AppliedMigrationRow {
  filename: string;
  checksum: string;
}

function loadMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), "utf8");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      };
    });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dir = join(process.cwd(), "migrations", "postgres");
    const files = loadMigrationFiles(dir);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedRows = await client.query<AppliedMigrationRow>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename ASC"
    );
    const appliedByFilename = new Map(
      appliedRows.rows.map((row) => [row.filename, row.checksum])
    );

    for (const file of files) {
      const appliedChecksum = appliedByFilename.get(file.filename);
      if (appliedChecksum) {
        if (appliedChecksum !== file.checksum) {
          throw new Error(
            `Migration checksum mismatch for ${file.filename}. ` +
              "The file changed after it was applied; create a new migration instead."
          );
        }
        continue;
      }

      await client.query(file.sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [file.filename, file.checksum]
      );
      console.log(`applied ${file.filename}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
