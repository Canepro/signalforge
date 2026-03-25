/**
 * Backend-parity tests: run the same behavioral suite against SQLite and Postgres.
 *
 * SQLite runs always (in-memory).
 * Postgres runs only when DATABASE_URL_TEST (or DATABASE_URL) is set.
 *
 * Run just parity tests:
 *   bun test tests/storage/parity
 *
 * With Postgres:
 *   DATABASE_URL_TEST=postgres://signalforge:signalforge@127.0.0.1:5432/signalforge bun test tests/storage/parity
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Storage } from "@/lib/storage/contract";
import { getTestSqliteStorage } from "@/lib/storage/sqlite";
import { Pool, type PoolClient } from "pg";

const FIXTURES = join(__dirname, "../fixtures");
const SAMPLE_LOG = readFileSync(join(FIXTURES, "sample-prod-server.log"), "utf-8");
const POSTGRES_MIGRATIONS_DIR = join(process.cwd(), "migrations", "postgres");

type BackendSetup = {
  name: string;
  getStorage: () => Promise<Storage>;
  teardown?: () => Promise<void>;
};

type MigrationFile = {
  filename: string;
  sql: string;
  checksum: string;
};

type PostgresSchemaSnapshot = {
  tables: Array<{ table_name: string }>;
  columns: Array<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;
  indexes: Array<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>;
  constraints: Array<{
    table_name: string;
    constraint_name: string;
    definition: string;
  }>;
  appliedMigrations: Array<{
    filename: string;
    checksum: string;
  }>;
};

const backends: BackendSetup[] = [
  {
    name: "sqlite",
    getStorage: () => getTestSqliteStorage(),
  },
];

const pgUrl = process.env.DATABASE_URL_TEST?.trim() || process.env.DATABASE_URL?.trim();
if (pgUrl) {
  backends.push({
    name: "postgres",
    getStorage: async () => {
      const { getTestPostgresStorage } = await import("@/lib/storage/postgres");
      const pg = await getTestPostgresStorage();
      backends.find((b) => b.name === "postgres")!.teardown = pg.teardown;
      return pg.storage;
    },
  });
}

function loadPostgresMigrationFiles(): MigrationFile[] {
  return readdirSync(POSTGRES_MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(POSTGRES_MIGRATIONS_DIR, filename), "utf8");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      };
    });
}

async function prepareMigrationHistoryTable(client: PoolClient, schema: string) {
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function applyMigrationFiles(
  client: PoolClient,
  schema: string,
  files: MigrationFile[]
) {
  await prepareMigrationHistoryTable(client, schema);
  await client.query(`SET search_path TO "${schema}"`);

  const existingResult = await client.query<{ filename: string; checksum: string }>(
    "SELECT filename, checksum FROM schema_migrations ORDER BY filename"
  );
  const existingByFilename = new Map(
    existingResult.rows.map((row) => [row.filename, row.checksum])
  );

  for (const file of files) {
    const existingChecksum = existingByFilename.get(file.filename);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== file.checksum) {
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
    existingByFilename.set(file.filename, file.checksum);
  }
}

async function capturePostgresSchemaSnapshot(
  client: PoolClient,
  schema: string
): Promise<PostgresSchemaSnapshot> {
  await client.query(`SET search_path TO "${schema}"`);

  const [tables, columns, indexes, constraints, appliedMigrations] = await Promise.all([
    client.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `,
      [schema]
    ),
    client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `,
      [schema]
    ),
    client.query<{
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      `
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1
        ORDER BY tablename, indexname
      `,
      [schema]
    ),
    client.query<{
      table_name: string;
      constraint_name: string;
      definition: string;
    }>(
      `
        SELECT rel.relname AS table_name, con.conname AS constraint_name, pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = $1
        ORDER BY rel.relname, con.conname
      `,
      [schema]
    ),
    client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
      []
    ),
  ]);

  return {
    tables: tables.rows,
    columns: columns.rows.map((column) => ({
      ...column,
      column_default: column.column_default?.replaceAll(`'${schema}.`, "'<schema>.") ?? null,
    })),
    indexes: indexes.rows.map((index) => ({
      ...index,
      indexdef: index.indexdef.replaceAll(`${schema}.`, "<schema>."),
    })),
    constraints: constraints.rows,
    appliedMigrations: appliedMigrations.rows,
  };
}

async function withTemporarySchema<T>(
  pool: Pool,
  fn: (client: PoolClient, schema: string) => Promise<T>
): Promise<T> {
  const schema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    return await fn(client, schema);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
}

function fakeAnalysis(): import("@/lib/analyzer/schema").AnalysisResult {
  return {
    report: {
      summary: ["test summary"],
      findings: [
        {
          id: "f1",
          title: "Test finding",
          severity: "medium",
          category: "test",
          section_source: "TEST",
          evidence: "test evidence line",
          why_it_matters: "matters for parity",
          recommended_action: "fix it",
        },
      ],
      environment_context: {
        hostname: "test-host",
        os: "Test OS",
        kernel: "0.0.0",
        uptime: "0 days",
        is_wsl: false,
        is_container: false,
        is_virtual_machine: false,
        ran_as_root: false,
      },
      noise_or_expected: [],
      top_actions_now: ["action 1", "action 2", "action 3"],
    },
    environment: { hostname: "test-host", os: "Test OS", kernel: "0.0.0", uptime: "0 days", is_wsl: false, is_container: false, is_virtual_machine: false, ran_as_root: false },
    noise: [],
    pre_findings: [],
    is_incomplete: false,
    incomplete_reason: undefined,
    analysis_error: undefined,
    meta: { model_used: "test", tokens_used: 0, duration_ms: 0, llm_succeeded: false },
  };
}

for (const backend of backends) {
  describe(`storage parity [${backend.name}]`, () => {
    let storage: Storage;

    beforeAll(async () => {
      storage = await backend.getStorage();
    });

    afterAll(async () => {
      await backend.teardown?.();
    });

    // --- RUNS ---

    it("persistAnalyzedRun creates a run and artifact", async () => {
      const result = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "linux-audit-log",
          sourceType: "api",
          filename: "test.log",
          content: SAMPLE_LOG,
          ingestion: {
            target_identifier: "parity-host-1",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );
      expect(result.run_id).toBeTruthy();
      expect(result.artifact_id).toBeTruthy();
      expect(result.status).toBe("complete");
    });

    it("listSummaries returns created runs", async () => {
      const runs = await storage.runs.listSummaries();
      expect(runs.length).toBeGreaterThanOrEqual(1);
      const run = runs.find((r) => r.target_identifier === "parity-host-1");
      expect(run).toBeDefined();
      expect(run!.status).toBe("complete");
      expect(run!.severity_counts).toHaveProperty("medium");
    });

    it("getApiDetail returns run detail with report", async () => {
      const runs = await storage.runs.listSummaries();
      const detail = await storage.runs.getApiDetail(runs[0]!.id);
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe(runs[0]!.id);
      expect(detail!.status).toBe("complete");
    });

    it("getReport returns parsed report", async () => {
      const runs = await storage.runs.listSummaries();
      const report = await storage.runs.getReport(runs[0]!.id);
      expect(report).not.toBeNull();
      expect((report as { findings: unknown[] }).findings.length).toBeGreaterThan(0);
    });

    it("getApiDetail returns null for missing run", async () => {
      const detail = await storage.runs.getApiDetail("00000000-0000-0000-0000-000000000000");
      expect(detail).toBeNull();
    });

    it("reanalyze creates a child run", async () => {
      const runs = await storage.runs.listSummaries();
      const parentId = runs[0]!.id;
      const src = await storage.runs.getReanalyzeSource(parentId);
      expect(src.ok).toBe(true);
      if (!src.ok) return;
      const child = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: src.artifact_type,
          sourceType: "api",
          filename: "reanalyzed.log",
          content: src.content,
          ingestion: {
            target_identifier: src.submission.target_identifier ?? null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
          parentRunId: parentId,
        })
      );
      expect(child.run_id).not.toBe(parentId);
      expect(child.artifact_id).toBe(src.artifact_id);
    });

    it("same bytes remain distinct across artifact families", async () => {
      const first = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "linux-audit-log",
          sourceType: "api",
          filename: "same-linux.log",
          content: "same-bytes-cross-family",
          ingestion: {
            target_identifier: "cross-family",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const second = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "container-diagnostics",
          sourceType: "api",
          filename: "same-container.log",
          content: "same-bytes-cross-family",
          ingestion: {
            target_identifier: "cross-family",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      expect(second.artifact_id).not.toBe(first.artifact_id);

      const firstDetail = await storage.runs.getApiDetail(first.run_id);
      const secondDetail = await storage.runs.getApiDetail(second.run_id);
      expect(firstDetail?.artifact_type).toBe("linux-audit-log");
      expect(secondDetail?.artifact_type).toBe("container-diagnostics");
    });

    it("compare finds implicit baseline after reanalyze", async () => {
      const runs = await storage.runs.listSummaries();
      const child = runs.find((run) => run.filename === "reanalyzed.log");
      expect(child).toBeTruthy();
      const result = await storage.runs.getComparePayload(child!.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.baseline_missing).toBe(false);
    });

    // --- SOURCES ---

    it("create and list sources", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Parity Host",
          target_identifier: "parity-src-1",
          source_type: "linux_host",
        })
      );
      expect(src.id).toBeTruthy();
      expect(src.health_status).toBe("unknown");
      expect(src.enabled).toBe(true);

      const list = await storage.sources.list();
      expect(list.some((s) => s.id === src.id)).toBe(true);
    });

    it("duplicate target_identifier throws", async () => {
      await expect(
        storage.withTransaction((tx) =>
          tx.sources.create({
            display_name: "Dup",
            target_identifier: "parity-src-1",
            source_type: "wsl",
          })
        )
      ).rejects.toThrow();
    });

    it("unsupported expected_artifact_type throws", async () => {
      await expect(
        storage.withTransaction((tx) =>
          tx.sources.create({
            display_name: "Unsupported",
            target_identifier: "unsupported-artifact-source",
            source_type: "linux_host",
            expected_artifact_type: "container-diagnostics",
          })
        )
      ).rejects.toThrow();
    });

    it("update source fields", async () => {
      const list = await storage.sources.list();
      const src = list.find((s) => s.target_identifier === "parity-src-1")!;
      const updated = await storage.withTransaction((tx) =>
        tx.sources.update(src.id, { display_name: "Renamed Host", enabled: false })
      );
      expect(updated!.display_name).toBe("Renamed Host");
      expect(updated!.enabled).toBe(false);
    });

    it("getById returns null for missing source", async () => {
      const result = await storage.sources.getById("00000000-0000-0000-0000-000000000000");
      expect(result).toBeNull();
    });

    it("delete source removes registration and source-scoped jobs", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Delete Host",
          target_identifier: "parity-delete-host",
          source_type: "linux_host",
        })
      );
      await storage.withTransaction((tx) => tx.agents.createRegistration(src.id, "delete-agent"));
      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, { request_reason: "cleanup test" })
      );

      const deleted = await storage.withTransaction((tx) => tx.sources.delete(src.id));
      expect(deleted).toEqual({ ok: true });
      expect(await storage.sources.getById(src.id)).toBeNull();
      expect(await storage.agents.getRegistrationBySourceId(src.id)).toBeNull();
      expect(await storage.jobs.getById(job.id)).toBeNull();
      expect(await storage.jobs.listForSource(src.id)).toHaveLength(0);
    });

    it("delete source rejects claimed or running jobs", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Blocked Delete Host",
          target_identifier: "parity-delete-blocked",
          source_type: "wsl",
        })
      );
      const { row: reg } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id, "blocked-delete-agent")
      );
      await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: null,
          instanceId: null,
        })
      );
      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, { request_reason: "active delete block" })
      );
      await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-delete", 300)
      );

      const deleted = await storage.withTransaction((tx) => tx.sources.delete(src.id));
      expect(deleted).toEqual({ ok: false, code: "active_jobs" });
      expect(await storage.sources.getById(src.id)).not.toBeNull();
      expect(await storage.jobs.getById(job.id)).not.toBeNull();
    });

    // --- JOBS ---

    it("queue and list collection jobs", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Job Host",
          target_identifier: "parity-job-host",
          source_type: "wsl",
        })
      );
      const { row, inserted } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, { request_reason: "parity test" })
      );
      expect(inserted).toBe(true);
      expect(row.status).toBe("queued");

      const jobs = await storage.jobs.listForSource(src.id);
      expect(jobs.some((j) => j.id === row.id)).toBe(true);
    });

    it("cancel a queued job", async () => {
      const sources = await storage.sources.list();
      const src = sources.find((s) => s.target_identifier === "parity-job-host")!;
      const jobs = await storage.jobs.listForSource(src.id);
      const job = jobs.find((j) => j.status === "queued")!;
      const cancelled = await storage.withTransaction((tx) => tx.jobs.cancel(job.id));
      expect(cancelled!.status).toBe("cancelled");
    });

    it("queueForSource with disabled source throws", async () => {
      const list = await storage.sources.list();
      const disabled = list.find((s) => s.target_identifier === "parity-src-1")!;
      await expect(
        storage.withTransaction((tx) =>
          tx.jobs.queueForSource(disabled.id, {})
        )
      ).rejects.toThrow();
    });

    // --- AGENTS ---

    it("enroll agent and resolve by token hash", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Agent Host",
          target_identifier: "parity-agent-host",
          source_type: "linux_host",
        })
      );
      const { row, plainToken, token_prefix } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id, "test-agent")
      );
      expect(row.id).toBeTruthy();
      expect(plainToken.length).toBeGreaterThan(20);
      expect(token_prefix.length).toBe(8);

      const { hashAgentToken } = await import("@/lib/db/source-job-repository");
      const resolved = await storage.agents.resolveRequestContextByTokenHash(hashAgentToken(plainToken));
      expect(resolved).not.toBeNull();
      expect(resolved!.registration.id).toBe(row.id);
      expect(resolved!.source.id).toBe(src.id);
    });

    it("duplicate agent enrollment throws", async () => {
      const list = await storage.sources.list();
      const src = list.find((s) => s.target_identifier === "parity-agent-host")!;
      await expect(
        storage.withTransaction((tx) => tx.agents.createRegistration(src.id))
      ).rejects.toThrow();
    });

    it("reissues an existing agent token and invalidates the old one", async () => {
      const list = await storage.sources.list();
      const src = list.find((s) => s.target_identifier === "parity-agent-host")!;
      const { hashAgentToken } = await import("@/lib/db/source-job-repository");

      const first = await storage.agents.getRegistrationBySourceId(src.id);
      expect(first).not.toBeNull();

      const initial = await storage.withTransaction((tx) =>
        tx.agents.rotateRegistration(src.id)
      );
      const rotated = await storage.withTransaction((tx) =>
        tx.agents.rotateRegistration(src.id)
      );

      expect(rotated.row.id).toBe(initial.row.id);
      expect(rotated.plainToken).not.toBe(initial.plainToken);
      expect(rotated.token_prefix).toHaveLength(8);

      const oldResolved = await storage.agents.resolveRequestContextByTokenHash(
        hashAgentToken(initial.plainToken)
      );
      expect(oldResolved).toBeNull();

      const newResolved = await storage.agents.resolveRequestContextByTokenHash(
        hashAgentToken(rotated.plainToken)
      );
      expect(newResolved).not.toBeNull();
      expect(newResolved!.registration.id).toBe(initial.row.id);
      expect(newResolved!.source.id).toBe(src.id);
    });

    // --- FULL AGENT LIFECYCLE ---

    it("claim → start → fail lifecycle", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Lifecycle Host",
          target_identifier: "parity-lifecycle",
          source_type: "wsl",
        })
      );
      const { row: reg, plainToken } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id)
      );

      const hb = await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: null,
          instanceId: null,
        })
      );
      expect(hb.ok).toBe(true);

      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, { request_reason: "lifecycle test" })
      );

      const next = await storage.withTransaction((tx) =>
        tx.jobs.listNextForAgent(src.id, reg.id, 1)
      );
      expect(next.jobs.length).toBe(1);
      expect(next.jobs[0]!.id).toBe(job.id);

      const claimed = await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-1", 300)
      );
      expect(claimed.ok).toBe(true);

      const started = await storage.withTransaction((tx) =>
        tx.jobs.startForAgent(job.id, src.id, reg.id, "inst-1")
      );
      expect(started.ok).toBe(true);

      const failed = await storage.withTransaction((tx) =>
        tx.jobs.failForAgent(job.id, src.id, reg.id, "inst-1", "test_fail", "test failure")
      );
      expect(failed.ok).toBe(true);
      if (failed.ok) expect(failed.row.status).toBe("failed");
    });

    it("claim → start → submit artifact lifecycle", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Submit Host",
          target_identifier: "parity-submit",
          source_type: "linux_host",
        })
      );
      const { row: reg } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id)
      );
      await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: null,
          instanceId: null,
        })
      );
      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, {})
      );
      await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-s", 300)
      );
      await storage.withTransaction((tx) =>
        tx.jobs.startForAgent(job.id, src.id, reg.id, "inst-s")
      );

      const submitted = await storage.withTransaction((tx) =>
        tx.jobs.submitArtifactForAgent({
          jobId: job.id,
          sourceId: src.id,
          registrationId: reg.id,
          instanceId: "inst-s",
          artifactType: "linux-audit-log",
          sourceType: "agent",
          filename: "parity.log",
          content: SAMPLE_LOG,
          ingestion: {
            target_identifier: "parity-submit",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      expect(submitted.job.status).toBe("submitted");
      expect(submitted.run_id).toBeTruthy();
      expect(submitted.artifact_id).toBeTruthy();
      expect(submitted.run_status).toBe("complete");
    });

    it("submitArtifactForAgent rejects artifact_type mismatch", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Mismatch Host",
          target_identifier: "parity-submit-mismatch",
          source_type: "linux_host",
        })
      );
      const { row: reg } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id)
      );
      await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: null,
          instanceId: null,
        })
      );
      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, {})
      );
      await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-sm", 300)
      );
      await storage.withTransaction((tx) =>
        tx.jobs.startForAgent(job.id, src.id, reg.id, "inst-sm")
      );

      const submitted = await storage.withTransaction((tx) =>
        tx.jobs.submitArtifactForAgent({
          jobId: job.id,
          sourceId: src.id,
          registrationId: reg.id,
          instanceId: "inst-sm",
          artifactType: "container-diagnostics",
          sourceType: "agent",
          filename: "parity.log",
          content: SAMPLE_LOG,
          ingestion: {
            target_identifier: "parity-submit-mismatch",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      expect(submitted).toEqual({
        ok: false,
        code: "artifact_type_mismatch",
      });
    });

    it("heartbeat extends lease on active job", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Lease Host",
          target_identifier: "parity-lease",
          source_type: "wsl",
        })
      );
      const { row: reg } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id)
      );
      await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: null,
          instanceId: null,
        })
      );
      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, {})
      );
      await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-l", 300)
      );
      await storage.withTransaction((tx) =>
        tx.jobs.startForAgent(job.id, src.id, reg.id, "inst-l")
      );

      const hb = await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: job.id,
          instanceId: "inst-l",
        })
      );
      expect(hb.ok).toBe(true);
      if (!hb.ok) return;
      expect(hb.result.active_job_lease.requested).toBe(true);
      if (hb.result.active_job_lease.requested && "extended" in hb.result.active_job_lease) {
        expect(hb.result.active_job_lease.extended).toBe(true);
      }
    });

    it("claim conflict returns not_queued for already-claimed job", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Conflict Host",
          target_identifier: "parity-conflict",
          source_type: "linux_host",
        })
      );
      const { row: reg } = await storage.withTransaction((tx) =>
        tx.agents.createRegistration(src.id)
      );
      await storage.withTransaction((tx) =>
        tx.agents.applyHeartbeat({
          sourceId: src.id,
          registrationId: reg.id,
          capabilities: ["collect:linux-audit-log"],
          attributes: {},
          agentVersion: "0.1.0",
          activeJobId: null,
          instanceId: null,
        })
      );
      const { row: job } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, {})
      );
      await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-c", 300)
      );
      const second = await storage.withTransaction((tx) =>
        tx.jobs.claimForAgent(job.id, src.id, reg.id, "inst-c2", 300)
      );
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.code).toBe("not_queued");
    });

    if (backend.name === "postgres" && pgUrl) {
      const migrationFiles = loadPostgresMigrationFiles();

      it.skipIf(migrationFiles.length < 2)(
        "fresh-install and upgrade-path migrations converge on the same schema",
        async () => {
          const pool = new Pool({ connectionString: pgUrl });
          try {
            const freshSnapshot = await withTemporarySchema(pool, async (client, schema) => {
              await applyMigrationFiles(client, schema, migrationFiles);
              return capturePostgresSchemaSnapshot(client, schema);
            });

            const upgradeSnapshot = await withTemporarySchema(pool, async (client, schema) => {
              await applyMigrationFiles(client, schema, migrationFiles.slice(0, 1));
              await applyMigrationFiles(client, schema, migrationFiles.slice(1));
              return capturePostgresSchemaSnapshot(client, schema);
            });

            expect(upgradeSnapshot).toEqual(freshSnapshot);
          } finally {
            await pool.end();
          }
        }
      );
    }
  });
}
