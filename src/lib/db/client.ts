import initSqlJs, { type Database } from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export type { Database } from "sql.js";

let _db: Database | null = null;
let _dbPath: string | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;
  const SQL = await initSqlJs();
  const dbPath = process.env.DATABASE_PATH ?? join(process.cwd(), "signalforge.db");
  _dbPath = dbPath;

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
  }

  migrate(_db);
  return _db;
}

export function saveDb(): void {
  if (_db && _dbPath) {
    const data = _db.export();
    writeFileSync(_dbPath, Buffer.from(data));
  }
}

export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

export async function getTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      artifact_type TEXT NOT NULL DEFAULT 'linux-audit-log',
      source_type TEXT NOT NULL DEFAULT 'api',
      filename TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id),
      parent_run_id TEXT REFERENCES runs(id),
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      report_json TEXT,
      environment_json TEXT,
      noise_json TEXT,
      pre_findings_json TEXT,
      is_incomplete INTEGER NOT NULL DEFAULT 0,
      incomplete_reason TEXT,
      analysis_error TEXT,
      model_used TEXT,
      tokens_used INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0
    );
  `);
}
