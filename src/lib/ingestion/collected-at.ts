import type { Database } from "sql.js";
import type { Pool, PoolClient } from "pg";
import { parseKubernetesBundle } from "@/lib/adapter/kubernetes-bundle/parse";

const COLLECTOR_FILENAME_TIME_RE =
  /^(?:server_audit|container[-_]diagnostics|kubernetes[-_]bundle)(?:_[a-z0-9._-]+)?_(\d{8})_(\d{6})\.[a-z0-9]+$/i;

type BackfillRow = {
  id: string;
  artifact_type: string;
  filename: string;
  content: string;
  created_at: string;
  source_label: string | null;
};

export type CollectedAtBackfillSummary = {
  scanned: number;
  updated: number;
  skipped: number;
};

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function parseTimestampParts(yyyymmdd: string, hhmmss: string): string | null {
  const year = Number.parseInt(yyyymmdd.slice(0, 4), 10);
  const month = Number.parseInt(yyyymmdd.slice(4, 6), 10);
  const day = Number.parseInt(yyyymmdd.slice(6, 8), 10);
  const hour = Number.parseInt(hhmmss.slice(0, 2), 10);
  const minute = Number.parseInt(hhmmss.slice(2, 4), 10);
  const second = Number.parseInt(hhmmss.slice(4, 6), 10);

  if ([year, month, day, hour, minute, second].some(Number.isNaN)) {
    return null;
  }

  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  ).toISOString();
}

export function inferCollectedAtFromFilename(filename: string): string | null {
  const match = filename.match(COLLECTOR_FILENAME_TIME_RE);
  if (!match) return null;
  const [, yyyymmdd, hhmmss] = match;
  return parseTimestampParts(yyyymmdd, hhmmss);
}

export function inferCollectedAtFromUploadedFile(
  file: { lastModified?: number },
  filename: string
): string | null {
  const fromFilename = inferCollectedAtFromFilename(filename);
  if (fromFilename) {
    return fromFilename;
  }

  if (
    typeof file.lastModified === "number" &&
    Number.isFinite(file.lastModified) &&
    file.lastModified > 0
  ) {
    return new Date(file.lastModified).toISOString();
  }

  return null;
}

export function inferCollectedAtForStoredRun(row: BackfillRow): string | null {
  if (row.artifact_type === "kubernetes-bundle") {
    const manifest = parseKubernetesBundle(row.content);
    const fromManifest = normalizeIsoTimestamp(manifest?.collected_at);
    if (fromManifest) return fromManifest;
  }

  const fromFilename = inferCollectedAtFromFilename(row.filename);
  if (fromFilename) return fromFilename;

  if (row.source_label?.startsWith("agent:")) {
    return normalizeIsoTimestamp(row.created_at);
  }

  return null;
}

function readSqliteBackfillRows(db: Database): BackfillRow[] {
  const stmt = db.prepare(`
    SELECT r.id, a.artifact_type, r.filename, a.content, r.created_at, r.source_label
    FROM runs r
    JOIN artifacts a ON a.id = r.artifact_id
    WHERE r.collected_at IS NULL
  `);

  const rows: BackfillRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as BackfillRow);
  }
  stmt.free();
  return rows;
}

export function backfillMissingCollectedAtInSqlite(db: Database): CollectedAtBackfillSummary {
  const rows = readSqliteBackfillRows(db);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const collectedAt = inferCollectedAtForStoredRun(row);
    if (!collectedAt) {
      skipped += 1;
      continue;
    }

    db.run("UPDATE runs SET collected_at = ? WHERE id = ? AND collected_at IS NULL", [
      collectedAt,
      row.id,
    ]);
    updated += 1;
  }

  return { scanned: rows.length, updated, skipped };
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function readPostgresBackfillRows(q: Queryable): Promise<BackfillRow[]> {
  const result = await q.query<BackfillRow>(`
    SELECT r.id, a.artifact_type, r.filename, a.content, r.created_at, r.source_label
    FROM runs r
    JOIN artifacts a ON a.id = r.artifact_id
    WHERE r.collected_at IS NULL
  `);
  return result.rows;
}

export async function backfillMissingCollectedAtInPostgres(
  q: Queryable
): Promise<CollectedAtBackfillSummary> {
  const rows = await readPostgresBackfillRows(q);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const collectedAt = inferCollectedAtForStoredRun(row);
    if (!collectedAt) {
      skipped += 1;
      continue;
    }

    await q.query("UPDATE runs SET collected_at = $1 WHERE id = $2 AND collected_at IS NULL", [
      collectedAt,
      row.id,
    ]);
    updated += 1;
  }

  return { scanned: rows.length, updated, skipped };
}
