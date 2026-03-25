import type { Database } from "sql.js";
import { createHash, randomUUID } from "crypto";
import type { AnalysisResult } from "../analyzer/schema";
import { normalizeTargetIdentifier } from "../target-identity";

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
  filename: string;
  source_type: string;
  /** Per submission / analysis run (Phase 5a); null when unset or legacy rows. */
  target_identifier: string | null;
  source_label: string | null;
  collector_type: string | null;
  collector_version: string | null;
  collected_at: string | null;
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
  hostname: string | null;
  env_tags: string[];
  target_identifier: string | null;
  collector_type: string | null;
}

export interface RunSubmissionMeta {
  filename: string;
  source_type: string;
  target_identifier?: string | null;
  source_label?: string | null;
  collector_type?: string | null;
  collector_version?: string | null;
  collected_at?: string | null;
}

/** Copy ingestion fields for reanalyze so metadata follows the logical submission chain. */
export function submissionMetaFromRun(row: RunRow): RunSubmissionMeta {
  return {
    filename: row.filename,
    source_type: row.source_type,
    target_identifier: row.target_identifier ?? null,
    source_label: row.source_label ?? null,
    collector_type: row.collector_type ?? null,
    collector_version: row.collector_version ?? null,
    collected_at: row.collected_at ?? null,
  };
}

function legacyContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Family-aware artifact hash for new writes.
 *
 * The default artifact type preserves current callers/tests for the shipped
 * `linux-audit-log` family, while insert lookup still falls back to the legacy
 * raw-content hash for pre-upgrade rows.
 */
export function contentHash(
  content: string,
  artifactType = "linux-audit-log"
): string {
  return createHash("sha256")
    .update(artifactType, "utf8")
    .update("\0")
    .update(content, "utf8")
    .digest("hex");
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

function findArtifactByContent(
  db: Database,
  artifactType: string,
  content: string
): ArtifactRow | null {
  const familyHash = contentHash(content, artifactType);
  const legacyHash = legacyContentHash(content);
  return getOne<ArtifactRow>(
    db,
    `SELECT * FROM artifacts
     WHERE content_hash = ?
        OR (artifact_type = ? AND content_hash = ?)
     ORDER BY CASE WHEN content_hash = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [familyHash, artifactType, legacyHash, familyHash]
  );
}

/**
 * Deduplicates by content_hash. On a cache hit, the returned row reflects the **first** insert’s
 * artifact-table metadata; use `insertRun` with per-submission `filename` / `source_type` for API truth.
 */
export function insertArtifact(
  db: Database,
  opts: {
    artifact_type: string;
    source_type: string;
    filename: string;
    content: string;
  }
): ArtifactRow {
  const hash = contentHash(opts.content, opts.artifact_type);
  const existing = findArtifactByContent(db, opts.artifact_type, opts.content);
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
  submission: RunSubmissionMeta,
  parentRunId?: string
): RunRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status = result.analysis_error && !result.report ? "error" : "complete";

  const ti = submission.target_identifier ?? null;
  const sl = submission.source_label ?? null;
  const cty = submission.collector_type ?? null;
  const cv = submission.collector_version ?? null;
  const cat = submission.collected_at ?? null;

  db.run(
    `INSERT INTO runs (
      id, artifact_id, parent_run_id, created_at, status,
      report_json, environment_json, noise_json, pre_findings_json,
      is_incomplete, incomplete_reason, analysis_error,
      model_used, tokens_used, duration_ms, filename, source_type,
      target_identifier, source_label, collector_type, collector_version, collected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      submission.filename,
      submission.source_type,
      ti,
      sl,
      cty,
      cv,
      cat,
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
    environment_json: string | null;
    target_identifier: string | null;
    collector_type: string | null;
  }>(db, `
    SELECT r.id, r.artifact_id, r.filename, a.artifact_type, r.source_type,
           r.created_at, r.status, r.report_json, r.environment_json,
           r.target_identifier, r.collector_type
    FROM runs r
    JOIN artifacts a ON r.artifact_id = a.id
    ORDER BY r.created_at DESC
  `);

  return rows.map((row) => {
    const hostname = parseEnvironmentHostname(row.environment_json);
    let envTags: string[] = [];
    if (row.environment_json) {
      try {
        const env = JSON.parse(row.environment_json);
        if (env.is_wsl) envTags.push("WSL");
        if (env.is_container) envTags.push("Container");
        if (env.is_virtual_machine) envTags.push("VM");
        if (!env.is_wsl && !env.is_container && !env.is_virtual_machine) envTags.push("Linux");
      } catch { /* skip */ }
    }
    return {
      id: row.id,
      artifact_id: row.artifact_id,
      filename: row.filename,
      artifact_type: row.artifact_type,
      source_type: row.source_type,
      created_at: row.created_at,
      status: row.status,
      severity_counts: deriveSeverityCounts(row.report_json),
      hostname,
      env_tags: envTags,
      target_identifier: row.target_identifier ?? null,
      collector_type: row.collector_type ?? null,
    };
  });
}

export function getRun(db: Database, id: string): RunRow | null {
  return getOne<RunRow>(db, "SELECT * FROM runs WHERE id = ?", [id]);
}

export function getArtifactById(db: Database, id: string): ArtifactRow | null {
  return getOne<ArtifactRow>(db, "SELECT * FROM artifacts WHERE id = ?", [id]);
}

export function deleteRunById(db: Database, id: string): void {
  db.run("DELETE FROM runs WHERE id = ?", [id]);
}

export function deleteArtifactIfUnreferenced(db: Database, id: string): void {
  const ref = getOne<{ refs: number }>(
    db,
    "SELECT COUNT(*) AS refs FROM runs WHERE artifact_id = ?",
    [id]
  );
  if ((ref?.refs ?? 0) === 0) {
    db.run("DELETE FROM artifacts WHERE id = ?", [id]);
  }
}

export function normalizeEnvironmentHostname(hostname: string | null | undefined): string | null {
  const normalized = hostname?.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return null;
  return normalized;
}

export function parseEnvironmentHostname(environmentJson: string | null): string | null {
  if (!environmentJson) return null;
  try {
    const env = JSON.parse(environmentJson) as { hostname?: string | null };
    return normalizeEnvironmentHostname(env.hostname);
  } catch {
    return null;
  }
}

/**
 * Latest run for the same artifact that is strictly older than the current run
 * (by `created_at`, tie-breaker excluded via `id != currentRunId`).
 */
export function findPreviousRunForSameArtifact(
  db: Database,
  currentRunId: string
): RunRow | null {
  const current = getRun(db, currentRunId);
  if (!current) return null;
  return getOne<RunRow>(
    db,
    `SELECT r.* FROM runs r
     WHERE r.artifact_id = ? AND r.id != ? AND r.created_at < ?
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [current.artifact_id, currentRunId, current.created_at]
  );
}

/**
 * Latest older run for the same logical target (Phase 5b).
 *
 * Matching order:
 * 1. If current run has `target_identifier`, match candidates with the same normalized
 *    target_identifier only (hostname is ignored for baseline selection).
 * 2. Else if analyzed hostname is available, match candidates with the same hostname
 *    (legacy behavior; candidate may or may not have target_identifier).
 * 3. Else fall back to same-artifact previous run (reanalyze chain / no stable identity).
 */
export function findPreviousRunForSameTarget(
  db: Database,
  currentRunId: string
): RunRow | null {
  const current = getRunWithArtifact(db, currentRunId);
  if (!current) return null;

  const currentTid = normalizeTargetIdentifier(current.target_identifier);
  const currentHostname = parseEnvironmentHostname(current.environment_json);

  const candidates = allRows<RunRow & { artifact_type: string }>(
    db,
    `SELECT r.*, a.artifact_type
     FROM runs r
     JOIN artifacts a ON r.artifact_id = a.id
     WHERE r.id != ? AND r.created_at < ? AND a.artifact_type = ?
     ORDER BY r.created_at DESC`,
    [currentRunId, current.created_at, current.artifact_type]
  );

  if (currentTid) {
    const hit = candidates.find(
      (c) => normalizeTargetIdentifier(c.target_identifier) === currentTid
    );
    return hit ?? null;
  }

  if (currentHostname) {
    return (
      candidates.find(
        (c) =>
          parseEnvironmentHostname(c.environment_json) === currentHostname
      ) ?? null
    );
  }

  return findPreviousRunForSameArtifact(db, currentRunId);
}

export function getRunWithArtifact(
  db: Database,
  id: string
): (RunRow & { artifact_type: string }) | null {
  return getOne<RunRow & { artifact_type: string }>(
    db,
    `SELECT r.*, a.artifact_type
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
