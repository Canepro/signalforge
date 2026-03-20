import type { Database } from "sql.js";
import { createHash, randomUUID } from "crypto";
import type { AnalysisResult } from "../analyzer/schema.js";

export interface ArtifactRow {
  id: string;
  created_at: string;
  artifact_type: string;
  source_type: string;
  filename: string;
  content_hash: string;
  content: string;
}

export interface RunRow {
  id: string;
  artifact_id: string;
  parent_run_id: string | null;
  created_at: string;
  status: string;
  report_json: string | null;
  environment_json: string | null;
  noise_json: string | null;
  pre_findings_json: string | null;
  is_incomplete: number;
  incomplete_reason: string | null;
  analysis_error: string | null;
  model_used: string | null;
  tokens_used: number;
  duration_ms: number;
}

export interface RunSummary {
  id: string;
  artifact_id: string;
  filename: string;
  artifact_type: string;
  source_type: string;
  created_at: string;
  status: string;
  severity_counts: Record<string, number>;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function rowToObject<T>(stmt: { getAsObject: (params?: unknown) => Record<string, unknown> }): T | null {
  const obj = stmt.getAsObject();
  if (!obj || Object.keys(obj).length === 0) return null;
  return obj as unknown as T;
}

function allRows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

function getOne<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const obj = stmt.getAsObject() as unknown as T;
    stmt.free();
    return obj;
  }
  stmt.free();
  return null;
}

export function findArtifactByHash(db: Database, hash: string): ArtifactRow | null {
  return getOne<ArtifactRow>(db, "SELECT * FROM artifacts WHERE content_hash = ?", [hash]);
}

export function insertArtifact(
  db: Database,
  opts: {
    artifact_type: string;
    source_type: string;
    filename: string;
    content: string;
  }
): ArtifactRow {
  const hash = contentHash(opts.content);
  const existing = findArtifactByHash(db, hash);
  if (existing) return existing;

  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO artifacts (id, created_at, artifact_type, source_type, filename, content_hash, content)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, now, opts.artifact_type, opts.source_type, opts.filename, hash, opts.content]
  );

  return getOne<ArtifactRow>(db, "SELECT * FROM artifacts WHERE id = ?", [id])!;
}

export function insertRun(
  db: Database,
  artifactId: string,
  result: AnalysisResult,
  parentRunId?: string
): RunRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status = result.analysis_error && !result.report ? "error" : "complete";

  db.run(
    `INSERT INTO runs (
      id, artifact_id, parent_run_id, created_at, status,
      report_json, environment_json, noise_json, pre_findings_json,
      is_incomplete, incomplete_reason, analysis_error,
      model_used, tokens_used, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      artifactId,
      parentRunId ?? null,
      now,
      status,
      result.report ? JSON.stringify(result.report) : null,
      JSON.stringify(result.environment),
      JSON.stringify(result.noise),
      JSON.stringify(result.pre_findings),
      result.is_incomplete ? 1 : 0,
      result.incomplete_reason ?? null,
      result.analysis_error ?? null,
      result.meta.model_used,
      result.meta.tokens_used,
      result.meta.duration_ms,
    ]
  );

  return getOne<RunRow>(db, "SELECT * FROM runs WHERE id = ?", [id])!;
}

export function listRuns(db: Database): RunSummary[] {
  const rows = allRows<{
    id: string;
    artifact_id: string;
    filename: string;
    artifact_type: string;
    source_type: string;
    created_at: string;
    status: string;
    report_json: string | null;
  }>(db, `
    SELECT r.id, r.artifact_id, a.filename, a.artifact_type, a.source_type,
           r.created_at, r.status, r.report_json
    FROM runs r
    JOIN artifacts a ON r.artifact_id = a.id
    ORDER BY r.created_at DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    artifact_id: row.artifact_id,
    filename: row.filename,
    artifact_type: row.artifact_type,
    source_type: row.source_type,
    created_at: row.created_at,
    status: row.status,
    severity_counts: deriveSeverityCounts(row.report_json),
  }));
}

export function getRun(db: Database, id: string): RunRow | null {
  return getOne<RunRow>(db, "SELECT * FROM runs WHERE id = ?", [id]);
}

export function getRunWithArtifact(
  db: Database,
  id: string
): (RunRow & { filename: string; artifact_type: string; source_type: string }) | null {
  return getOne<RunRow & { filename: string; artifact_type: string; source_type: string }>(
    db,
    `SELECT r.*, a.filename, a.artifact_type, a.source_type
     FROM runs r JOIN artifacts a ON r.artifact_id = a.id
     WHERE r.id = ?`,
    [id]
  );
}

export function deriveSeverityCounts(reportJson: string | null): Record<string, number> {
  if (!reportJson) return {};
  try {
    const report = JSON.parse(reportJson);
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of report.findings ?? []) {
      const sev = finding.severity;
      if (sev in counts) counts[sev]++;
    }
    return counts;
  } catch {
    return {};
  }
}
