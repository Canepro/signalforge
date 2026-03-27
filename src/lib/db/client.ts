import initSqlJs, { type Database } from "sql.js";
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

export type { Database } from "sql.js";

let _db: Database | null = null;
let _dbPath: string | null = null;
let _dbMtimeMs: number | null = null;

/** When set, `getDb()` returns this instance (tests only). */
let _dbOverride: Database | null = null;

export function setDbOverride(db: Database | null): void {
  _dbOverride = db;
}

function resolveDbPath(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), "signalforge.db");
}

function getDbMtimeMs(dbPath: string): number | null {
  if (!existsSync(dbPath)) return null;
  return statSync(dbPath).mtimeMs;
}

async function loadDbFromPath(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs(sqlJsInitOptions());
  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();
  migrate(db);
  _dbPath = dbPath;
  _dbMtimeMs = getDbMtimeMs(dbPath);
  return db;
}

function sqlJsInitOptions(): { locateFile: (file: string) => string } {
  const nodeModulesDist = join(process.cwd(), "node_modules", "sql.js", "dist");
  const tracedDist = join(process.cwd(), ".next", "server", "vendor-chunks", "sql.js", "dist");
  return {
    locateFile: (file: string) => {
      const tracedPath = join(tracedDist, file);
      if (existsSync(tracedPath)) return tracedPath;
      return join(nodeModulesDist, file);
    },
  };
}

export async function initSqlJsForApp(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  return initSqlJs(sqlJsInitOptions());
}

export async function getDb(): Promise<Database> {
  if (_dbOverride) return _dbOverride;
  const dbPath = resolveDbPath();
  if (_db && _dbPath === dbPath) {
    const diskMtimeMs = getDbMtimeMs(dbPath);
    if (diskMtimeMs === _dbMtimeMs) {
      return _db;
    }
  }
  _db = await loadDbFromPath(dbPath);
  return _db;
}

export async function reloadDbFromDisk(): Promise<Database> {
  if (_dbOverride) return _dbOverride;
  const dbPath = resolveDbPath();
  _db = await loadDbFromPath(dbPath);
  return _db;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDbFileLock<T>(fn: () => Promise<T>): Promise<T> {
  if (_dbOverride) return fn();

  const dbPath = resolveDbPath();
  const lockPath = `${dbPath}.lock`;
  const deadline = Date.now() + 10_000;

  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        return await fn();
      } finally {
        closeSync(fd);
        unlinkSync(lockPath);
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for SQLite lock at ${lockPath}`, {
          cause: error,
        });
      }
      await sleep(25);
    }
  }
}

export function saveDb(): void {
  if (_dbOverride) return;
  if (_db && _dbPath) {
    const data = _db.export();
    writeFileSync(_dbPath, Buffer.from(data));
    _dbMtimeMs = getDbMtimeMs(_dbPath);
  }
}

export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
    _dbMtimeMs = null;
  }
}

export async function getTestDb(): Promise<Database> {
  const SQL = await initSqlJs(sqlJsInitOptions());
  const db = new SQL.Database();
  migrate(db);
  return db;
}

function tableColumnNames(db: Database, table: string): string[] {
  const result = db.exec(`PRAGMA table_info(${table})`);
  if (!result.length || !result[0].values.length) return [];
  const cols = result[0].columns;
  const nameIdx = cols.indexOf("name");
  if (nameIdx < 0) return [];
  return (result[0].values as unknown[][]).map((row) => String(row[nameIdx]));
}

function migrate(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      artifact_type TEXT NOT NULL DEFAULT 'linux-audit-log',
      source_type TEXT NOT NULL DEFAULT 'api',
      filename TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS runs (
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
      duration_ms INTEGER DEFAULT 0,
      filename TEXT NOT NULL DEFAULT 'untitled.log',
      source_type TEXT NOT NULL DEFAULT 'api'
    )`);

  const runCols = tableColumnNames(db, "runs");
  if (!runCols.includes("filename")) {
    db.run(`ALTER TABLE runs ADD COLUMN filename TEXT NOT NULL DEFAULT 'untitled.log'`);
  }
  if (!runCols.includes("source_type")) {
    db.run(`ALTER TABLE runs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'api'`);
  }

  const runColsAfterBase = tableColumnNames(db, "runs");
  const ingestionCols = [
    "target_identifier",
    "source_label",
    "collector_type",
    "collector_version",
    "collected_at",
  ] as const;
  for (const col of ingestionCols) {
    if (!runColsAfterBase.includes(col)) {
      db.run(`ALTER TABLE runs ADD COLUMN ${col} TEXT`);
    }
  }

  db.run(`CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    target_identifier TEXT NOT NULL,
    target_identifier_norm TEXT,
    source_type TEXT NOT NULL,
    expected_artifact_type TEXT NOT NULL,
    default_collector_type TEXT NOT NULL,
    default_collector_version TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    attributes_json TEXT NOT NULL DEFAULT '{}',
    labels_json TEXT NOT NULL DEFAULT '{}',
    default_collection_scope_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  const sourceCols = tableColumnNames(db, "sources");
  if (!sourceCols.includes("target_identifier_norm")) {
    db.run(`ALTER TABLE sources ADD COLUMN target_identifier_norm TEXT`);
  }
  db.run(
    `UPDATE sources
     SET target_identifier_norm = lower(trim(target_identifier))
     WHERE target_identifier_norm IS NULL OR target_identifier_norm = ''`
  );
  if (!sourceCols.includes("default_collection_scope_json")) {
    db.run(`ALTER TABLE sources ADD COLUMN default_collection_scope_json TEXT`);
  }

  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_target_enabled ON sources(target_identifier) WHERE enabled = 1`
  );
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_target_enabled_norm
     ON sources(target_identifier_norm) WHERE enabled = 1`
  );

  db.run(`CREATE TABLE IF NOT EXISTS collection_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    artifact_type TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    request_reason TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    lease_owner_id TEXT,
    lease_owner_instance_id TEXT,
    lease_expires_at TEXT,
    last_heartbeat_at TEXT,
    result_artifact_id TEXT,
    result_run_id TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    queued_at TEXT,
    claimed_at TEXT,
    started_at TEXT,
    submitted_at TEXT,
    finished_at TEXT,
    collection_scope_json TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_collection_jobs_source ON collection_jobs(source_id)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_collection_jobs_idempotency ON collection_jobs(source_id, idempotency_key)`
  );

  const jobCols = tableColumnNames(db, "collection_jobs");
  if (!jobCols.includes("result_analysis_status")) {
    db.run(`ALTER TABLE collection_jobs ADD COLUMN result_analysis_status TEXT`);
  }
  if (!jobCols.includes("collection_scope_json")) {
    db.run(`ALTER TABLE collection_jobs ADD COLUMN collection_scope_json TEXT`);
  }

  db.run(`CREATE TABLE IF NOT EXISTS agent_registrations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),
    token_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL
  )`);

  const agentRegCols = tableColumnNames(db, "agent_registrations");
  if (!agentRegCols.includes("last_capabilities_json")) {
    db.run(
      `ALTER TABLE agent_registrations ADD COLUMN last_capabilities_json TEXT NOT NULL DEFAULT '[]'`
    );
  }
  if (!agentRegCols.includes("last_heartbeat_at")) {
    db.run(`ALTER TABLE agent_registrations ADD COLUMN last_heartbeat_at TEXT`);
  }
  if (!agentRegCols.includes("last_agent_version")) {
    db.run(`ALTER TABLE agent_registrations ADD COLUMN last_agent_version TEXT`);
  }
  if (!agentRegCols.includes("last_instance_id")) {
    db.run(`ALTER TABLE agent_registrations ADD COLUMN last_instance_id TEXT`);
  }
}
