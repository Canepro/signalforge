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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

function fakeAnalysisWithoutFindings(): import("@/lib/analyzer/schema").AnalysisResult {
  const base = fakeAnalysis();
  if (!base.report) return base;
  return {
    ...base,
    report: {
      ...base.report,
      findings: [],
      top_actions_now: [],
    },
  };
}

function containerArtifact(fields: Record<string, string>): string {
  const orderedKeys = [
    "hostname",
    "runtime",
    "container_name",
    "image",
    "state_status",
    "health_status",
    "restart_count",
    "oom_killed",
    "exit_code",
    "published_ports",
    "mounts",
    "writable_mounts",
    "read_only_rootfs",
    "added_capabilities",
    "secrets",
    "ran_as_root",
    "memory_limit_bytes",
    "memory_reservation_bytes",
    "cpu_percent",
    "memory_percent",
    "pid_count",
    "failure_log_excerpts_json",
  ];
  return [
    "=== container-diagnostics ===",
    ...orderedKeys
      .filter((key) => key in fields)
      .map((key) => `${key}: ${fields[key]}`),
  ].join("\n");
}

function kubernetesBundleArtifact(input: {
  clusterName: string;
  scopeLevel: "cluster" | "namespace";
  namespace?: string;
  documents?: Array<{
    path: string;
    kind: string;
    media_type: string;
    content: string;
  }>;
}): string {
  return JSON.stringify(
    {
      schema_version: "kubernetes-bundle.v1",
      cluster: { name: input.clusterName, provider: "aks" },
      scope: {
        level: input.scopeLevel,
        namespace: input.scopeLevel === "namespace" ? (input.namespace ?? null) : null,
      },
      documents: input.documents ?? [],
    },
    null,
    2
  );
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

    it("listDashboardSignalRuns returns read-optimized attention runs", async () => {
      const actionable = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "linux-audit-log",
          sourceType: "api",
          filename: "dashboard-actionable.log",
          content: "dashboard-actionable-content",
          ingestion: {
            target_identifier: "parity-dashboard-actionable",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "linux-audit-log",
          sourceType: "api",
          filename: "dashboard-quiet.log",
          content: "dashboard-quiet-content",
          ingestion: {
            target_identifier: "parity-dashboard-actionable",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysisWithoutFindings(),
        })
      );

      const rows = await storage.runs.listDashboardSignalRuns(50);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.length).toBeLessThanOrEqual(50);
      expect(rows.some((row) => row.run.id === actionable.run_id)).toBe(true);
      for (const row of rows) {
        const score =
          (row.run.severity_counts.critical ?? 0) * 1000 +
          (row.run.severity_counts.high ?? 0) * 100 +
          (row.run.severity_counts.medium ?? 0) * 10 +
          (row.run.severity_counts.low ?? 0);
        expect(score).toBeGreaterThan(0);
        expect(row.findings.length).toBeGreaterThan(0);
      }
    });

    it("listDashboardSignalRuns still returns older actionable runs after many newer quiet runs", async () => {
      const actionable = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "linux-audit-log",
          sourceType: "api",
          filename: "sparse-actionable.log",
          content: "sparse-actionable-content",
          ingestion: {
            target_identifier: "parity-sparse-signal",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 25));

      await storage.withTransaction(async (tx) => {
        for (let idx = 0; idx < 130; idx++) {
          await tx.runs.persistAnalyzedRun({
            artifactType: "linux-audit-log",
            sourceType: "api",
            filename: `sparse-quiet-${idx}.log`,
            content: `sparse-quiet-content-${idx}`,
            ingestion: {
              target_identifier: "parity-sparse-signal",
              source_label: null,
              collector_type: null,
              collector_version: null,
              collected_at: null,
            },
            analysis: fakeAnalysisWithoutFindings(),
          });
        }
      });

      const rows = await storage.runs.listDashboardSignalRuns(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.run.id).toBe(actionable.run_id);
      expect(rows[0]!.findings.length).toBeGreaterThan(0);
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
      const runWithFindings =
        runs.find((run) =>
          (run.severity_counts.critical ?? 0) +
            (run.severity_counts.high ?? 0) +
            (run.severity_counts.medium ?? 0) +
            (run.severity_counts.low ?? 0) >
          0
        ) ?? runs[0]!;
      const report = await storage.runs.getReport(runWithFindings.id);
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
      expect(result.payload.evidence_delta).not.toBeNull();
    });

    it("compare exposes container evidence_delta metrics when findings are unchanged", async () => {
      const older = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "container-diagnostics",
          sourceType: "api",
          filename: "payments-before.txt",
          content: containerArtifact({
            hostname: "node-a",
            runtime: "docker",
            container_name: "payments",
            image: "registry.example/payments:1.2.3",
            state_status: "running",
            health_status: "healthy",
            restart_count: "0",
            oom_killed: "false",
            published_ports: "8080:80",
            mounts: "/srv/config:/config",
            writable_mounts: "/config",
            read_only_rootfs: "true",
            added_capabilities: "NET_BIND_SERVICE",
            secrets: "db-password",
            ran_as_root: "false",
            memory_limit_bytes: "536870912",
            memory_reservation_bytes: "134217728",
            failure_log_excerpts_json: "[]",
          }),
          ingestion: {
            target_identifier: "container:payments",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const newer = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "container-diagnostics",
          sourceType: "api",
          filename: "payments-after.txt",
          content: containerArtifact({
            hostname: "node-a",
            runtime: "docker",
            container_name: "payments",
            image: "registry.example/payments:1.2.4",
            state_status: "restarting",
            health_status: "unhealthy",
            restart_count: "4",
            oom_killed: "true",
            published_ports: "8080:80,8443:443",
            mounts: "/srv/config:/config,/srv/data:/data",
            writable_mounts: "/config,/data",
            read_only_rootfs: "false",
            added_capabilities: "NET_BIND_SERVICE,SYS_PTRACE",
            secrets: "db-password,api-key",
            ran_as_root: "true",
            memory_limit_bytes: "1073741824",
            memory_reservation_bytes: "268435456",
            failure_log_excerpts_json:
              '[{"source":"current","reason":"restarting","excerpt_lines":["2026-03-26T10:06:00Z retrying database connection"],"line_count":1,"truncated":false},{"source":"previous","reason":"restarting","excerpt_lines":["2026-03-26T10:05:10Z panic: database connection refused"],"line_count":1,"truncated":false}]',
          }),
          ingestion: {
            target_identifier: "container:payments",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const result = await storage.runs.getComparePayload(newer.run_id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.baseline_missing).toBe(false);
      expect(result.payload.baseline?.id).toBe(older.run_id);
      expect(result.payload.drift.rows).toEqual([]);
      expect(result.payload.evidence_delta?.changed).toBe(true);
      expect(result.payload.evidence_delta?.metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "published_port_count",
            family: "container-diagnostics",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "added_capability_count",
            family: "container-diagnostics",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "secret_mount_count",
            family: "container-diagnostics",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "mount_count",
            family: "container-diagnostics",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "writable_mount_count",
            family: "container-diagnostics",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "runs_as_root",
            family: "container-diagnostics",
            previous: false,
            current: true,
            status: "changed",
          }),
          expect.objectContaining({
            key: "read_only_rootfs",
            family: "container-diagnostics",
            previous: true,
            current: false,
            status: "changed",
          }),
          expect.objectContaining({
            key: "state_status",
            family: "container-diagnostics",
            previous: "running",
            current: "restarting",
            status: "changed",
          }),
          expect.objectContaining({
            key: "health_status",
            family: "container-diagnostics",
            previous: "healthy",
            current: "unhealthy",
            status: "changed",
          }),
          expect.objectContaining({
            key: "restart_count",
            family: "container-diagnostics",
            previous: 0,
            current: 4,
            status: "changed",
          }),
          expect.objectContaining({
            key: "oom_killed",
            family: "container-diagnostics",
            previous: false,
            current: true,
            status: "changed",
          }),
          expect.objectContaining({
            key: "failure_log_excerpt_count",
            family: "container-diagnostics",
            previous: 0,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "memory_limit_bytes",
            family: "container-diagnostics",
            previous: 536870912,
            current: 1073741824,
            status: "changed",
            unit: "bytes",
          }),
          expect.objectContaining({
            key: "memory_reservation_bytes",
            family: "container-diagnostics",
            previous: 134217728,
            current: 268435456,
            status: "changed",
            unit: "bytes",
          }),
        ])
      );
    });

    it("compare exposes Kubernetes evidence_delta metrics when findings are unchanged", async () => {
      const older = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "kubernetes-bundle",
          sourceType: "api",
          filename: "payments-before.json",
          content: kubernetesBundleArtifact({
            clusterName: "aks-prod-eu-1",
            scopeLevel: "namespace",
            namespace: "payments",
            documents: [
              {
                path: "network/services.json",
                kind: "service-exposure",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    type: "LoadBalancer",
                    external: true,
                  },
                ]),
              },
              {
                path: "rbac/bindings.json",
                kind: "rbac-bindings",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    scope: "cluster",
                    subject: "system:serviceaccount:payments:payments-api",
                    roleRef: "Cluster-Admin",
                  },
                  {
                    scope: "namespace",
                    namespace: "payments",
                    subject: "system:serviceaccount:payments:payments-api",
                    roleRef: "payments-ops",
                  },
                ]),
              },
              {
                path: "rbac/roles.json",
                kind: "rbac-roles",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    scope: "namespace",
                    namespace: "payments",
                    name: "payments-ops",
                    rules: [
                      {
                        apiGroups: ["*"],
                        resources: ["*"],
                        verbs: ["*"],
                      },
                    ],
                  },
                ]),
              },
              {
                path: "network/network-policies.json",
                kind: "network-policies",
                media_type: "application/json",
                content: JSON.stringify([]),
              },
              {
                path: "cluster/node-health.json",
                kind: "node-health",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    name: "aks-system-000001",
                    ready: true,
                    unschedulable: false,
                    pressure_conditions: [],
                  },
                ]),
              },
              {
                path: "events/warning-events.json",
                kind: "warning-events",
                media_type: "application/json",
                content: JSON.stringify([]),
              },
              {
                path: "workloads/rollout-status.json",
                kind: "workload-rollout-status",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    kind: "Deployment",
                    desired_replicas: 2,
                    ready_replicas: 2,
                    available_replicas: 2,
                    updated_replicas: 2,
                    unavailable_replicas: 0,
                    generation: 4,
                    observed_generation: 4,
                  },
                ]),
              },
              {
                path: "autoscaling/horizontal-pod-autoscalers.json",
                kind: "horizontal-pod-autoscalers",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    scale_target_kind: "Deployment",
                    scale_target_name: "payments-api",
                    min_replicas: 2,
                    max_replicas: 4,
                    current_replicas: 2,
                    desired_replicas: 2,
                    current_cpu_utilization_percentage: 48,
                    target_cpu_utilization_percentage: 70,
                    conditions: [
                      {
                        type: "ScalingActive",
                        status: "True",
                        reason: "ValidMetricFound",
                        message: "scaling active",
                      },
                    ],
                  },
                ]),
              },
              {
                path: "policy/pod-disruption-budgets.json",
                kind: "pod-disruption-budgets",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    min_available: "1",
                    current_healthy: 2,
                    desired_healthy: 1,
                    disruptions_allowed: 1,
                    expected_pods: 2,
                  },
                ]),
              },
              {
                path: "quotas/resource-quotas.json",
                kind: "resource-quotas",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-quota",
                    resources: [
                      {
                        resource: "limits.memory",
                        hard: "8Gi",
                        used: "4Gi",
                        used_ratio: 0.5,
                      },
                    ],
                  },
                ]),
              },
              {
                path: "quotas/limit-ranges.json",
                kind: "limit-ranges",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-defaults",
                    has_default_requests: true,
                    has_default_limits: true,
                  },
                ]),
              },
              {
                path: "storage/persistent-volume-claims.json",
                kind: "persistent-volume-claims",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-data",
                    phase: "Bound",
                    volume_name: "pvc-payments-data",
                    storage_class_name: "managed-csi",
                    access_modes: ["ReadWriteOnce"],
                    requested_storage: "20Gi",
                    capacity_storage: "20Gi",
                    conditions: [],
                  },
                ]),
              },
              {
                path: "storage/persistent-volumes.json",
                kind: "persistent-volumes",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    name: "pvc-payments-data",
                    phase: "Bound",
                    storage_class_name: "managed-csi",
                    reclaim_policy: "Delete",
                    claim_namespace: "payments",
                    claim_name: "payments-data",
                    access_modes: ["ReadWriteOnce"],
                    capacity_storage: "20Gi",
                    reason: null,
                    message: null,
                  },
                ]),
              },
              {
                path: "logs/unhealthy-workload-excerpts.json",
                kind: "unhealthy-workload-log-excerpts",
                media_type: "application/json",
                content: JSON.stringify([]),
              },
              {
                path: "workloads/specs.json",
                kind: "workload-specs",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    kind: "Deployment",
                    pod_spec: {
                      serviceAccountName: "payments-api",
                      hostNetwork: false,
                      hostPID: false,
                      hostIPC: false,
                      securityContext: {
                        runAsNonRoot: true,
                        readOnlyRootFilesystem: true,
                        seccompProfile: { type: "RuntimeDefault" },
                      },
                      automountServiceAccountToken: false,
                      volumes: [
                        {
                          name: "payments-data",
                          persistentVolumeClaim: { claimName: "payments-data" },
                        },
                      ],
                      containers: [
                        {
                          name: "api",
                          env: [],
                          envFrom: [],
                          volumeMounts: [
                            {
                              name: "payments-data",
                              mountPath: "/var/lib/payments-data",
                            },
                          ],
                          securityContext: {
                            allowPrivilegeEscalation: false,
                            readOnlyRootFilesystem: true,
                            capabilities: { add: [] },
                          },
                          readinessProbe: { httpGet: { path: "/ready", port: 8080 } },
                          livenessProbe: { httpGet: { path: "/live", port: 8080 } },
                          resources: {
                            requests: { cpu: "100m", memory: "128Mi" },
                            limits: { cpu: "500m", memory: "256Mi" },
                          },
                        },
                      ],
                      initContainers: [],
                    },
                  },
                ]),
              },
            ],
          }),
          ingestion: {
            target_identifier: "cluster:aks-prod-eu-1:namespace:payments",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const newer = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "kubernetes-bundle",
          sourceType: "api",
          filename: "payments-after.json",
          content: kubernetesBundleArtifact({
            clusterName: "aks-prod-eu-1",
            scopeLevel: "namespace",
            namespace: "payments",
            documents: [
              {
                path: "network/services.json",
                kind: "service-exposure",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    type: "LoadBalancer",
                    external: true,
                  },
                  {
                    namespace: "payments",
                    name: "payments-metrics",
                    type: "NodePort",
                    external: false,
                  },
                ]),
              },
              {
                path: "rbac/bindings.json",
                kind: "rbac-bindings",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    scope: "cluster",
                    subject: "system:serviceaccount:payments:payments-api",
                    roleRef: "Cluster-Admin",
                  },
                  {
                    scope: "cluster",
                    subject: "system:serviceaccount:payments:payments-jobs",
                    roleRef: "cluster-admin",
                  },
                  {
                    scope: "namespace",
                    namespace: "payments",
                    subject: "system:serviceaccount:payments:default",
                    roleRef: "payments-ops",
                  },
                  {
                    scope: "namespace",
                    namespace: "payments",
                    subject: "system:serviceaccount:payments:default",
                    roleRef: "payments-automation",
                  },
                  {
                    scope: "cluster",
                    subject: "system:serviceaccount:payments:default",
                    roleRef: "payments-breakglass",
                  },
                ]),
              },
              {
                path: "rbac/roles.json",
                kind: "rbac-roles",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    scope: "namespace",
                    namespace: "payments",
                    name: "payments-ops",
                    rules: [
                      {
                        apiGroups: ["*"],
                        resources: ["*"],
                        verbs: ["*"],
                      },
                    ],
                  },
                  {
                    scope: "namespace",
                    namespace: "payments",
                    name: "payments-automation",
                    rules: [
                      {
                        apiGroups: ["*"],
                        resources: ["*"],
                        verbs: ["get", "list", "*"],
                      },
                    ],
                  },
                  {
                    scope: "cluster",
                    name: "payments-breakglass",
                    rules: [
                      {
                        apiGroups: ["rbac.authorization.k8s.io"],
                        resources: ["clusterroles"],
                        verbs: ["bind", "escalate", "impersonate"],
                      },
                      {
                        apiGroups: [""],
                        resources: ["nodes/proxy"],
                        verbs: ["get"],
                      },
                    ],
                  },
                ]),
              },
              {
                path: "network/network-policies.json",
                kind: "network-policies",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "default-deny",
                  },
                ]),
              },
              {
                path: "cluster/node-health.json",
                kind: "node-health",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    name: "aks-system-000001",
                    ready: false,
                    unschedulable: false,
                    pressure_conditions: ["MemoryPressure"],
                  },
                  {
                    name: "aks-user-000002",
                    ready: true,
                    unschedulable: false,
                    pressure_conditions: [],
                  },
                ]),
              },
              {
                path: "events/warning-events.json",
                kind: "warning-events",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    involved_kind: "Pod",
                    involved_name: "payments-api-abc123",
                    reason: "FailedScheduling",
                    message: "0/3 nodes are available: 3 Insufficient memory.",
                    count: 4,
                    last_timestamp: "2026-03-26T10:00:00Z",
                  },
                  {
                    namespace: "payments",
                    involved_kind: "Pod",
                    involved_name: "payments-api-abc123",
                    reason: "ImagePullBackOff",
                    message: "Back-off pulling image ghcr.io/acme/payments:bad",
                    count: 2,
                    last_timestamp: "2026-03-26T10:05:00Z",
                  },
                ]),
              },
              {
                path: "workloads/rollout-status.json",
                kind: "workload-rollout-status",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    kind: "Deployment",
                    desired_replicas: 3,
                    ready_replicas: 1,
                    available_replicas: 1,
                    updated_replicas: 2,
                    unavailable_replicas: 2,
                    generation: 5,
                    observed_generation: 4,
                  },
                ]),
              },
              {
                path: "autoscaling/horizontal-pod-autoscalers.json",
                kind: "horizontal-pod-autoscalers",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    scale_target_kind: "Deployment",
                    scale_target_name: "payments-api",
                    min_replicas: 2,
                    max_replicas: 3,
                    current_replicas: 3,
                    desired_replicas: 3,
                    current_cpu_utilization_percentage: 94,
                    target_cpu_utilization_percentage: 70,
                    conditions: [
                      {
                        type: "ScalingActive",
                        status: "False",
                        reason: "FailedGetResourceMetric",
                        message: "missing request for cpu",
                      },
                    ],
                  },
                ]),
              },
              {
                path: "policy/pod-disruption-budgets.json",
                kind: "pod-disruption-budgets",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    min_available: "2",
                    current_healthy: 1,
                    desired_healthy: 2,
                    disruptions_allowed: 0,
                    expected_pods: 3,
                  },
                ]),
              },
              {
                path: "quotas/resource-quotas.json",
                kind: "resource-quotas",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-quota",
                    resources: [
                      {
                        resource: "limits.memory",
                        hard: "8Gi",
                        used: "7.4Gi",
                        used_ratio: 0.925,
                      },
                    ],
                  },
                ]),
              },
              {
                path: "quotas/limit-ranges.json",
                kind: "limit-ranges",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-defaults",
                    has_default_requests: false,
                    has_default_limits: true,
                  },
                ]),
              },
              {
                path: "storage/persistent-volume-claims.json",
                kind: "persistent-volume-claims",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-data",
                    phase: "Pending",
                    volume_name: null,
                    storage_class_name: "managed-csi",
                    access_modes: ["ReadWriteOnce"],
                    requested_storage: "20Gi",
                    capacity_storage: null,
                    conditions: [],
                  },
                  {
                    namespace: "payments",
                    name: "payments-cache",
                    phase: "Bound",
                    volume_name: "pvc-payments-cache",
                    storage_class_name: "managed-csi",
                    access_modes: ["ReadWriteOnce"],
                    requested_storage: "8Gi",
                    capacity_storage: "8Gi",
                    conditions: [
                      {
                        type: "FileSystemResizePending",
                        status: "True",
                        reason: "WaitingForNodeExpansion",
                        message: "filesystem resize pending on node",
                      },
                    ],
                  },
                ]),
              },
              {
                path: "storage/persistent-volumes.json",
                kind: "persistent-volumes",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    name: "pv-payments-archive",
                    phase: "Released",
                    storage_class_name: "managed-csi",
                    reclaim_policy: "Retain",
                    claim_namespace: "payments",
                    claim_name: "payments-archive",
                    access_modes: ["ReadWriteOnce"],
                    capacity_storage: "100Gi",
                    reason: null,
                    message: null,
                  },
                ]),
              },
              {
                path: "logs/unhealthy-workload-excerpts.json",
                kind: "unhealthy-workload-log-excerpts",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    workload_kind: "Deployment",
                    workload_name: "payments-api",
                    pod_name: "payments-api-abc123",
                    container_name: "api",
                    reason: "CrashLoopBackOff",
                    restarts: 6,
                    previous: true,
                    excerpt_lines: [
                      "2026-03-26T10:05:10Z panic: database connection refused",
                      "2026-03-26T10:05:11Z retry budget exhausted after 5 attempts",
                    ],
                    line_count: 2,
                    truncated: false,
                  },
                  {
                    namespace: "payments",
                    workload_kind: "Deployment",
                    workload_name: "payments-worker",
                    pod_name: "payments-worker-abc123",
                    container_name: "worker",
                    reason: "Error",
                    restarts: 3,
                    previous: false,
                    excerpt_lines: [
                      "2026-03-26T10:09:10Z migration failed: deadlock detected",
                    ],
                    line_count: 1,
                    truncated: false,
                  },
                ]),
              },
              {
                path: "workloads/specs.json",
                kind: "workload-specs",
                media_type: "application/json",
                content: JSON.stringify([
                  {
                    namespace: "payments",
                    name: "payments-api",
                    kind: "Deployment",
                    pod_spec: {
                      serviceAccountName: "default",
                      automountServiceAccountToken: true,
                      hostNetwork: true,
                      hostPID: true,
                      hostIPC: true,
                      volumes: [
                        {
                          name: "payments-api-secrets-volume",
                          secret: { secretName: "payments-api-secrets" },
                        },
                        {
                          name: "payments-host-data",
                          hostPath: { path: "/var/lib/payments-data" },
                        },
                        {
                          name: "payments-token",
                          projected: {
                            sources: [
                              {
                                serviceAccountToken: {
                                  audience: "payments-api",
                                  expirationSeconds: 3600,
                                  path: "token",
                                },
                              },
                            ],
                          },
                        },
                        {
                          name: "payments-data",
                          persistentVolumeClaim: { claimName: "payments-data" },
                        },
                        {
                          name: "payments-cache",
                          persistentVolumeClaim: { claimName: "payments-cache" },
                        },
                      ],
                      containers: [
                        {
                          name: "api",
                          env: [
                            {
                              name: "DATABASE_URL",
                              valueFrom: {
                                secretKeyRef: { name: "payments-api-secrets", key: "database_url" },
                              },
                            },
                            {
                              name: "PAYMENTS_API_KEY",
                              valueFrom: {
                                secretKeyRef: { name: "payments-api-secrets", key: "api_key" },
                              },
                            },
                          ],
                          envFrom: [
                            {
                              secretRef: { name: "payments-api-env" },
                            },
                          ],
                          volumeMounts: [
                            {
                              name: "payments-api-secrets-volume",
                              mountPath: "/var/run/secrets/payments",
                              readOnly: true,
                            },
                            {
                              name: "payments-host-data",
                              mountPath: "/host/payments-data",
                            },
                            {
                              name: "payments-token",
                              mountPath: "/var/run/secrets/tokens",
                              readOnly: true,
                            },
                            {
                              name: "payments-data",
                              mountPath: "/var/lib/payments-data",
                            },
                            {
                              name: "payments-cache",
                              mountPath: "/var/cache/payments",
                            },
                          ],
                          securityContext: {
                            privileged: true,
                            allowPrivilegeEscalation: true,
                            runAsNonRoot: false,
                            readOnlyRootFilesystem: false,
                            capabilities: { add: ["NET_ADMIN"] },
                            seccompProfile: { type: "Unconfined" },
                          },
                          readinessProbe: null,
                          livenessProbe: null,
                          resources: {},
                        },
                      ],
                      initContainers: [
                        {
                          name: "bootstrap",
                          securityContext: { privileged: true },
                        },
                      ],
                    },
                  },
                ]),
              },
            ],
          }),
          ingestion: {
            target_identifier: "cluster:aks-prod-eu-1:namespace:payments",
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const result = await storage.runs.getComparePayload(newer.run_id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.baseline_missing).toBe(false);
      expect(result.payload.baseline?.id).toBe(older.run_id);
      expect(result.payload.drift.rows).toEqual([]);
      expect(result.payload.evidence_delta?.changed).toBe(true);
      expect(result.payload.evidence_delta?.metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "warning_event_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 6,
            status: "changed",
          }),
          expect.objectContaining({
            key: "node_not_ready_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "node_pressure_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "rollout_issue_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "unavailable_replica_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "hpa_issue_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "pdb_blocking_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "resource_quota_pressure_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "namespace_without_limit_range_default_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "unhealthy_workload_log_excerpt_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "pending_persistent_volume_claim_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "persistent_volume_claim_resize_pending_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "degraded_persistent_volume_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "workload_pending_persistent_volume_claim_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "external_service_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "cluster_admin_binding_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "workload_cluster_admin_binding_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 0,
            status: "changed",
          }),
          expect.objectContaining({
            key: "workload_rbac_wildcard_binding_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "workload_rbac_privilege_escalation_binding_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "workload_rbac_node_proxy_binding_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "externally_exposed_workload_cluster_admin_binding_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 0,
            status: "changed",
          }),
          expect.objectContaining({
            key: "externally_exposed_workload_rbac_wildcard_binding_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "externally_exposed_workload_rbac_privilege_escalation_binding_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "externally_exposed_workload_rbac_node_proxy_binding_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "externally_exposed_default_service_account_automount_workload_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "externally_exposed_projected_service_account_token_volume_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "network_policy_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "exposed_namespace_without_network_policy_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 0,
            status: "changed",
          }),
          expect.objectContaining({
            key: "workload_hardening_gap_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 14,
            status: "changed",
          }),
          expect.objectContaining({
            key: "rbac_wildcard_role_count",
            family: "kubernetes-bundle",
            previous: 1,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "rbac_privilege_escalation_role_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "rbac_node_proxy_access_role_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "service_account_token_automount_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "writable_root_filesystem_workload_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "default_service_account_automount_workload_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "secret_env_reference_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 2,
            status: "changed",
          }),
          expect.objectContaining({
            key: "secret_env_from_reference_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "secret_volume_mount_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "projected_service_account_token_volume_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "host_network_workload_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "host_pid_workload_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "host_ipc_workload_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "host_path_volume_mount_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "added_capability_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
          expect.objectContaining({
            key: "privileged_init_container_count",
            family: "kubernetes-bundle",
            previous: 0,
            current: 1,
            status: "changed",
          }),
        ])
      );
    });

    it("compare prefers matching container identity over hostname-only fallback", async () => {
      const olderPayments = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "container-diagnostics",
          sourceType: "api",
          filename: "payments-old.txt",
          content: containerArtifact({
            hostname: "node-a",
            runtime: "docker",
            container_name: "payments",
            image: "registry.example/payments:1.2.3",
          }),
          ingestion: {
            target_identifier: null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );
      const newerSearch = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "container-diagnostics",
          sourceType: "api",
          filename: "search.txt",
          content: containerArtifact({
            hostname: "node-a",
            runtime: "docker",
            container_name: "search",
            image: "registry.example/search:3.4.5",
          }),
          ingestion: {
            target_identifier: null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );
      const currentPayments = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "container-diagnostics",
          sourceType: "api",
          filename: "payments-new.txt",
          content: containerArtifact({
            hostname: "node-a",
            runtime: "docker",
            container_name: "payments",
            image: "registry.example/payments:1.2.4",
          }),
          ingestion: {
            target_identifier: null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const result = await storage.runs.getComparePayload(currentPayments.run_id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.baseline_missing).toBe(false);
      expect(result.payload.baseline?.id).toBe(olderPayments.run_id);
      expect(result.payload.baseline?.id).not.toBe(newerSearch.run_id);
    });

    it("compare prefers matching Kubernetes scope over hostname-only fallback", async () => {
      const olderPayments = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "kubernetes-bundle",
          sourceType: "api",
          filename: "payments-old.json",
          content: kubernetesBundleArtifact({
            clusterName: "aks-prod-eu-1",
            scopeLevel: "namespace",
            namespace: "payments",
          }),
          ingestion: {
            target_identifier: null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );
      const newerCheckout = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "kubernetes-bundle",
          sourceType: "api",
          filename: "checkout.json",
          content: kubernetesBundleArtifact({
            clusterName: "aks-prod-eu-1",
            scopeLevel: "namespace",
            namespace: "checkout",
          }),
          ingestion: {
            target_identifier: null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );
      const currentPayments = await storage.withTransaction((tx) =>
        tx.runs.persistAnalyzedRun({
          artifactType: "kubernetes-bundle",
          sourceType: "api",
          filename: "payments-new.json",
          content: kubernetesBundleArtifact({
            clusterName: "aks-prod-eu-1",
            scopeLevel: "namespace",
            namespace: "payments",
          }),
          ingestion: {
            target_identifier: null,
            source_label: null,
            collector_type: null,
            collector_version: null,
            collected_at: null,
          },
          analysis: fakeAnalysis(),
        })
      );

      const result = await storage.runs.getComparePayload(currentPayments.run_id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.baseline_missing).toBe(false);
      expect(result.payload.baseline?.id).toBe(olderPayments.run_id);
      expect(result.payload.baseline?.id).not.toBe(newerCheckout.run_id);
      expect(result.payload.current.target_display_label).toBe("aks-prod-eu-1 / namespace payments");
    });

    // --- SOURCES ---

    it("create and list sources", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Parity Host",
          target_identifier: "parity-src-1",
          source_type: "linux_host",
          default_collection_scope: { kind: "linux_host" },
        })
      );
      expect(src.id).toBeTruthy();
      expect(src.health_status).toBe("unknown");
      expect(src.enabled).toBe(true);
      expect(src.default_collection_scope?.kind).toBe("linux_host");

      const list = await storage.sources.list();
      expect(list.some((s) => s.id === src.id)).toBe(true);
    });

    it("listDashboardCollectionSourceStates returns source registration state in one read model query", async () => {
      const registered = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Dashboard Registered Host",
          target_identifier: "parity-dashboard-registered",
          source_type: "linux_host",
        })
      );
      const unregistered = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Dashboard Unregistered Host",
          target_identifier: "parity-dashboard-unregistered",
          source_type: "linux_host",
        })
      );
      const disabledRegistered = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Dashboard Disabled Registered Host",
          target_identifier: "parity-dashboard-disabled-registered",
          source_type: "linux_host",
          enabled: false,
        })
      );

      await storage.withTransaction((tx) => tx.agents.createRegistration(registered.id, "dashboard-agent"));
      await storage.withTransaction((tx) =>
        tx.agents.createRegistration(disabledRegistered.id, "dashboard-disabled-agent")
      );

      const enabledStates = await storage.sources.listDashboardCollectionSourceStates({ enabled: true });
      const registeredEnabled = enabledStates.find((entry) => entry.source.id === registered.id);
      const unregisteredEnabled = enabledStates.find((entry) => entry.source.id === unregistered.id);
      const disabledEnabled = enabledStates.find((entry) => entry.source.id === disabledRegistered.id);

      expect(registeredEnabled?.hasRegistration).toBe(true);
      expect(unregisteredEnabled?.hasRegistration).toBe(false);
      expect(disabledEnabled).toBeUndefined();

      const disabledStates = await storage.sources.listDashboardCollectionSourceStates({ enabled: false });
      const disabledEntry = disabledStates.find((entry) => entry.source.id === disabledRegistered.id);
      expect(disabledEntry?.hasRegistration).toBe(true);
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
            expected_artifact_type: "windows-evidence-pack",
          })
        )
      ).rejects.toThrow();
    });

    it("update source fields", async () => {
      const list = await storage.sources.list();
      const src = list.find((s) => s.target_identifier === "parity-src-1")!;
      const updated = await storage.withTransaction((tx) =>
        tx.sources.update(src.id, {
          display_name: "Renamed Host",
          enabled: false,
          default_collection_scope: null,
        })
      );
      expect(updated!.display_name).toBe("Renamed Host");
      expect(updated!.enabled).toBe(false);
      expect(updated!.default_collection_scope).toBeNull();
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
      expect(jobs.find((j) => j.id === row.id)?.collection_scope ?? null).toBeNull();
    });

    it("listForSource applies status filter after lease projection", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));

        const src = await storage.withTransaction((tx) =>
          tx.sources.create({
            display_name: "Projected status host",
            target_identifier: `parity-projected-status-${backend.name}`,
            source_type: "linux_host",
          })
        );
        const { row: registration } = await storage.withTransaction((tx) =>
          tx.agents.createRegistration(src.id, "status-projection-agent")
        );
        const { row: job } = await storage.withTransaction((tx) =>
          tx.jobs.queueForSource(src.id, { request_reason: "projection filter test" })
        );
        const claimed = await storage.withTransaction((tx) =>
          tx.jobs.claimForAgent(job.id, src.id, registration.id, "status-projection-instance", 120)
        );
        expect(claimed.ok).toBe(true);

        const initiallyClaimed = await storage.jobs.listForSource(src.id, { status: "claimed" });
        expect(initiallyClaimed.some((entry) => entry.id === job.id)).toBe(true);

        vi.setSystemTime(new Date("2026-04-06T12:10:00.000Z"));
        const projectedQueued = await storage.jobs.listForSource(src.id, { status: "queued" });
        expect(projectedQueued.some((entry) => entry.id === job.id)).toBe(true);

        vi.setSystemTime(new Date("2026-04-06T12:01:00.000Z"));
        const claimedAgain = await storage.jobs.listForSource(src.id, { status: "claimed" });
        expect(claimedAgain.some((entry) => entry.id === job.id)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("getById projects expired running leases without mutating persisted job state", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-04-06T13:00:00.000Z"));

        const src = await storage.withTransaction((tx) =>
          tx.sources.create({
            display_name: "Projected getById host",
            target_identifier: `parity-projected-getbyid-${backend.name}`,
            source_type: "linux_host",
          })
        );
        const { row: registration } = await storage.withTransaction((tx) =>
          tx.agents.createRegistration(src.id, "getbyid-projection-agent")
        );
        const { row: job } = await storage.withTransaction((tx) =>
          tx.jobs.queueForSource(src.id, { request_reason: "projection getById test" })
        );

        const claimed = await storage.withTransaction((tx) =>
          tx.jobs.claimForAgent(job.id, src.id, registration.id, "getbyid-projection-instance", 300)
        );
        expect(claimed.ok).toBe(true);
        const started = await storage.withTransaction((tx) =>
          tx.jobs.startForAgent(job.id, src.id, registration.id, "getbyid-projection-instance")
        );
        expect(started.ok).toBe(true);

        const beforeExpiry = await storage.jobs.getById(job.id);
        expect(beforeExpiry?.status).toBe("running");

        vi.setSystemTime(new Date("2026-04-06T13:10:00.000Z"));
        const projectedExpired = await storage.jobs.getById(job.id);
        expect(projectedExpired?.status).toBe("expired");
        expect(projectedExpired?.error_code).toBe("lease_lost");

        vi.setSystemTime(new Date("2026-04-06T13:01:00.000Z"));
        const runningAgain = await storage.jobs.getById(job.id);
        expect(runningAgain?.status).toBe("running");
      } finally {
        vi.useRealTimers();
      }
    });

    it("queueForSource stores typed collection_scope on the job", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Container Job Host",
          target_identifier: "parity-container-job-host",
          source_type: "linux_host",
          expected_artifact_type: "container-diagnostics",
        })
      );
      const { row } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, {
          request_reason: "container parity test",
          collection_scope: {
            kind: "container_target",
            runtime: "docker",
            container_ref: "api",
          },
        })
      );
      expect(row.collection_scope?.kind).toBe("container_target");
    });

    it("queueForSource uses source default_collection_scope when job override is absent", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Default scope source",
          target_identifier: "parity-default-scope-source",
          source_type: "linux_host",
          expected_artifact_type: "kubernetes-bundle",
          default_collection_scope: {
            kind: "kubernetes_scope",
            scope_level: "namespace",
            namespace: "payments",
          },
        })
      );
      const { row } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, { request_reason: "default scope parity test" })
      );
      expect(row.collection_scope?.kind).toBe("kubernetes_scope");
    });

    it("queueForSource idempotency returns the existing job before validating a replay payload", async () => {
      const src = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name: "Idempotent scope source",
          target_identifier: "parity-idempotent-scope-source",
          source_type: "linux_host",
          expected_artifact_type: "kubernetes-bundle",
          default_collection_scope: {
            kind: "kubernetes_scope",
            scope_level: "namespace",
            namespace: "payments",
          },
        })
      );
      const first = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, { idempotency_key: "replay-me" })
      );
      const replay = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(src.id, {
          idempotency_key: "replay-me",
          collection_scope: { kind: "linux_host" },
        })
      );
      expect(first.inserted).toBe(true);
      expect(replay.inserted).toBe(false);
      expect(replay.row.id).toBe(first.row.id);
      expect(replay.row.collection_scope?.kind).toBe("kubernetes_scope");
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

    it("listNextForAgentAfterLeaseReap requeues an expired claimed job in one storage boundary", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-04-06T15:00:00.000Z"));

        const src = await storage.withTransaction((tx) =>
          tx.sources.create({
            display_name: "Poll reaper host",
            target_identifier: `parity-poll-reaper-${backend.name}`,
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
          tx.jobs.queueForSource(src.id, { request_reason: "poll reaper test" })
        );
        await storage.withTransaction((tx) =>
          tx.jobs.claimForAgent(job.id, src.id, reg.id, "poll-reaper-inst", 120)
        );

        vi.setSystemTime(new Date("2026-04-06T15:10:00.000Z"));

        const polled = await storage.withTransaction((tx) =>
          tx.jobs.listNextForAgentAfterLeaseReap(src.id, reg.id, 1)
        );
        expect(polled.jobs).toHaveLength(1);
        expect(polled.jobs[0]?.id).toBe(job.id);
        expect(polled.gate).toBeNull();

        const queued = await storage.jobs.listForSource(src.id, { status: "queued" });
        expect(queued.some((entry) => entry.id === job.id)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
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
