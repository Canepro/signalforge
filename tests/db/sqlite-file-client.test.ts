import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

describe("sqlite file client", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "signalforge-sqlite-file-"));
    dbPath = join(tempDir, "signalforge.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reloads the latest on-disk database when another writer updates the file", () => {
    const clientModuleUrl = pathToFileURL(join(process.cwd(), "src/lib/db/client.ts")).href;
    const script = `
      import { readFileSync, statSync, utimesSync, writeFileSync } from "fs";
      import { getDb, initSqlJsForApp, saveDb } from "${clientModuleUrl}";

      const first = await getDb();
      first.run("CREATE TABLE marker (value TEXT NOT NULL)");
      first.run("INSERT INTO marker(value) VALUES ('first')");
      saveDb();

      const SQL = await initSqlJsForApp();
      const external = new SQL.Database(readFileSync(process.env.DATABASE_PATH));
      external.run("INSERT INTO marker(value) VALUES ('second')");
      writeFileSync(process.env.DATABASE_PATH, Buffer.from(external.export()));
      external.close();
      const stats = statSync(process.env.DATABASE_PATH);
      utimesSync(
        process.env.DATABASE_PATH,
        new Date(),
        new Date(Math.max(Date.now(), stats.mtimeMs + 2000))
      );

      const reloaded = await getDb();
      const rows = reloaded.exec("SELECT value FROM marker ORDER BY value");
      console.log(JSON.stringify(rows[0]?.values ?? []));
    `;

    const output = execFileSync("bun", ["-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: dbPath },
      encoding: "utf-8",
    }).trim();

    expect(JSON.parse(output)).toEqual([["first"], ["second"]]);
  });
});
