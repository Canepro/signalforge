import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTestDb, setDbOverride } from "@/lib/db/client";
import type { Database } from "sql.js";
import {
  cancelCollectionJob,
  insertCollectionJob,
  insertSource,
  createAgentRegistration,
  reapExpiredCollectionJobLeases,
  findRecentJobByIdempotencyKey,
  getCollectionJobById,
  listNextQueuedJobSummariesForSource,
  applyAgentHeartbeat,
  getSourceById,
  claimCollectionJobForAgent,
} from "@/lib/db/source-job-repository";
import { isCollectionScope } from "@/lib/collection-scope";

describe("source-job-repository", () => {
  let db: Database;

  beforeEach(async () => {
    db = await getTestDb();
    setDbOverride(db);
  });

  afterEach(() => {
    setDbOverride(null);
    db.close();
  });

  it("insertSource and duplicate enabled target_identifier conflict", () => {
    insertSource(db, {
      display_name: "A",
      target_identifier: "tid-1",
      source_type: "wsl",
    });
    expect(() =>
      insertSource(db, {
        display_name: "B",
        target_identifier: "tid-1",
        source_type: "linux_host",
      })
    ).toThrow();
  });

  it("insertSource treats enabled target_identifier as case-insensitively unique", () => {
    insertSource(db, {
      display_name: "A",
      target_identifier: "Prod-Host-1",
      source_type: "wsl",
    });
    expect(() =>
      insertSource(db, {
        display_name: "B",
        target_identifier: "prod-host-1",
        source_type: "linux_host",
      })
    ).toThrow();
  });

  it("insertSource validates and persists default_collection_scope", () => {
    expect(() =>
      insertSource(db, {
        display_name: "Bad source scope",
        target_identifier: "bad-source-scope",
        source_type: "linux_host",
        expected_artifact_type: "linux-audit-log",
        default_collection_scope: { kind: "container_target", container_ref: "api" },
      })
    ).toThrow();

    const ok = insertSource(db, {
      display_name: "Good source scope",
      target_identifier: "good-source-scope",
      source_type: "linux_host",
      expected_artifact_type: "kubernetes-bundle",
      default_collection_scope: { kind: "kubernetes_scope", scope_level: "cluster" },
    });
    expect(ok.default_collection_scope_json).toContain("\"kind\":\"kubernetes_scope\"");
  });

  it("isCollectionScope rejects extra properties and empty optional namespace", () => {
    expect(isCollectionScope({ kind: "linux_host", unexpected: true })).toBe(false);
    expect(
      isCollectionScope({
        kind: "kubernetes_scope",
        scope_level: "cluster",
        namespace: "",
      })
    ).toBe(false);
  });

  it("insertCollectionJob sets queued and artifact_type from source", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-x",
      source_type: "linux_host",
    });
    const { row, inserted } = insertCollectionJob(db, s, { request_reason: "test" });
    expect(inserted).toBe(true);
    expect(row.status).toBe("queued");
    expect(row.artifact_type).toBe("linux-audit-log");
    expect(row.requested_by).toBe("operator");
    expect(row.collection_scope_json ?? null).toBeNull();
  });

  it("insertCollectionJob stores collection_scope_json when valid", () => {
    const s = insertSource(db, {
      display_name: "Container source",
      target_identifier: "container-host-a",
      source_type: "linux_host",
      expected_artifact_type: "container-diagnostics",
    });
    const { row } = insertCollectionJob(db, s, {
      collection_scope: {
        kind: "container_target",
        runtime: "docker",
        container_ref: "payments-api",
      },
    });
    expect(row.collection_scope_json).toContain("\"kind\":\"container_target\"");
  });

  it("insertCollectionJob falls back to source default_collection_scope_json", () => {
    const s = insertSource(db, {
      display_name: "Defaulted scope source",
      target_identifier: "source-defaulted-scope",
      source_type: "linux_host",
      expected_artifact_type: "container-diagnostics",
      default_collection_scope: {
        kind: "container_target",
        runtime: "docker",
        container_ref: "payments-api",
      },
    });
    const { row } = insertCollectionJob(db, s, {});
    expect(row.collection_scope_json).toContain("\"container_ref\":\"payments-api\"");
  });

  it("insertCollectionJob rejects mismatched collection_scope kind", () => {
    const s = insertSource(db, {
      display_name: "Linux source",
      target_identifier: "linux-host-a",
      source_type: "linux_host",
      expected_artifact_type: "linux-audit-log",
    });
    expect(() =>
      insertCollectionJob(db, s, {
        collection_scope: {
          kind: "kubernetes_scope",
          scope_level: "cluster",
        },
      })
    ).toThrow();
  });

  it("insertCollectionJob idempotency returns same job", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-y",
      source_type: "linux_host",
    });
    const a = insertCollectionJob(db, s, { idempotency_key: "k1" });
    const b = insertCollectionJob(db, s, { idempotency_key: "k1" });
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(a.row.id).toBe(b.row.id);
  });

  it("insertCollectionJob idempotency returns existing job before validating a replay payload", () => {
    const s = insertSource(db, {
      display_name: "K8s source",
      target_identifier: "idempotent-k8s-source",
      source_type: "linux_host",
      expected_artifact_type: "kubernetes-bundle",
      default_collection_scope: {
        kind: "kubernetes_scope",
        scope_level: "namespace",
        namespace: "payments",
      },
    });
    const first = insertCollectionJob(db, s, { idempotency_key: "k-replay" });
    const replay = insertCollectionJob(db, s, {
      idempotency_key: "k-replay",
      collection_scope: { kind: "linux_host" },
    });
    expect(first.inserted).toBe(true);
    expect(replay.inserted).toBe(false);
    expect(replay.row.id).toBe(first.row.id);
    expect(replay.row.collection_scope_json).toContain("\"namespace\":\"payments\"");
  });

  it("findRecentJobByIdempotencyKey respects window", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-z",
      source_type: "linux_host",
    });
    const { row } = insertCollectionJob(db, s, { idempotency_key: "old" });
    const hit = findRecentJobByIdempotencyKey(db, s.id, "old", 24 * 60 * 60 * 1000);
    expect(hit).not.toBeNull();
    db.run(`UPDATE collection_jobs SET created_at = ? WHERE id = ?`, [
      "2000-01-01T00:00:00.000Z",
      row.id,
    ]);
    const miss = findRecentJobByIdempotencyKey(db, s.id, "old", 24 * 60 * 60 * 1000);
    expect(miss).toBeNull();
  });

  it("disabled source rejects new job", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-off",
      source_type: "linux_host",
      enabled: false,
    });
    expect(() => insertCollectionJob(db, s, {})).toThrow();
  });

  it("cancelCollectionJob from queued", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-c",
      source_type: "linux_host",
    });
    const { row } = insertCollectionJob(db, s, {});
    const updated = cancelCollectionJob(db, row.id);
    expect(updated?.status).toBe("cancelled");
    expect(updated?.error_code).toBe("cancelled");
  });

  it("cancelCollectionJob rejects running", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-r",
      source_type: "linux_host",
    });
    const { row } = insertCollectionJob(db, s, {});
    db.run(`UPDATE collection_jobs SET status = 'running' WHERE id = ?`, [row.id]);
    expect(() => cancelCollectionJob(db, row.id)).toThrow();
  });

  it("createAgentRegistration is unique per source", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-a",
      source_type: "linux_host",
    });
    const a = createAgentRegistration(db, s.id, "agent1");
    expect(a.plainToken.length).toBeGreaterThan(10);
    expect(() => createAgentRegistration(db, s.id, "agent2")).toThrow();
  });

  it("reapExpiredCollectionJobLeases requeues claimed and expires running", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-reap",
      source_type: "linux_host",
    });
    const agent = createAgentRegistration(db, s.id);
    const { row: j1 } = insertCollectionJob(db, s, {});
    const past = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE collection_jobs SET status = 'claimed', lease_owner_id = ?, lease_expires_at = ?, claimed_at = ? WHERE id = ?`,
      [agent.row.id, past, past, j1.id]
    );
    const { row: j2 } = insertCollectionJob(db, s, {});
    db.run(
      `UPDATE collection_jobs SET status = 'running', lease_owner_id = ?, lease_expires_at = ?, started_at = ? WHERE id = ?`,
      [agent.row.id, past, past, j2.id]
    );

    reapExpiredCollectionJobLeases(db);

    expect(getCollectionJobById(db, j1.id)?.status).toBe("queued");
    expect(getCollectionJobById(db, j2.id)?.status).toBe("expired");
  });

  it("listNextQueuedJobSummariesForSource strict heartbeat and capability gates", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-listnext",
      source_type: "linux_host",
    });
    const { row: reg0 } = createAgentRegistration(db, s.id);
    insertCollectionJob(db, s, {});

    const a = listNextQueuedJobSummariesForSource(db, s, reg0, 10);
    expect(a.jobs).toHaveLength(0);
    expect(a.gate).toBe("heartbeat_required");

    const out1 = applyAgentHeartbeat(db, reg0, s, {
      capabilities: [],
      attributes: {},
      agent_version: "1",
      active_job_id: null,
      instance_id: null,
    });
    const s1 = getSourceById(db, s.id)!;
    const b = listNextQueuedJobSummariesForSource(db, s1, out1.registration, 10);
    expect(b.jobs).toHaveLength(0);
    expect(b.gate).toBe("capabilities_empty");

    const out2 = applyAgentHeartbeat(db, out1.registration, s1, {
      capabilities: ["upload:multipart"],
      attributes: {},
      agent_version: "1",
      active_job_id: null,
      instance_id: null,
    });
    const s2 = getSourceById(db, s.id)!;
    const c = listNextQueuedJobSummariesForSource(db, s2, out2.registration, 10);
    expect(c.jobs).toHaveLength(0);
    expect(c.gate).toBe("capability_mismatch");

    const out3 = applyAgentHeartbeat(db, out2.registration, s2, {
      capabilities: ["collect:linux-audit-log"],
      attributes: {},
      agent_version: "1",
      active_job_id: null,
      instance_id: null,
    });
    const s3 = getSourceById(db, s.id)!;
    const d = listNextQueuedJobSummariesForSource(db, s3, out3.registration, 10);
    expect(d.jobs).toHaveLength(1);
    expect(d.gate).toBeNull();
  });

  it("listNextQueuedJobSummariesForSource includes collection_scope", () => {
    const s = insertSource(db, {
      display_name: "K8s source",
      target_identifier: "k8s-host-listnext",
      source_type: "linux_host",
      expected_artifact_type: "kubernetes-bundle",
    });
    const { row: reg } = createAgentRegistration(db, s.id);
    const hb = applyAgentHeartbeat(db, reg, s, {
      capabilities: ["collect:kubernetes-bundle"],
      attributes: {},
      agent_version: "1",
      active_job_id: null,
      instance_id: null,
    });
    insertCollectionJob(db, s, {
      collection_scope: {
        kind: "kubernetes_scope",
        scope_level: "namespace",
        namespace: "payments",
      },
    });
    const source = getSourceById(db, s.id)!;
    const next = listNextQueuedJobSummariesForSource(db, source, hb.registration, 1);
    expect(next.jobs).toHaveLength(1);
    expect(next.jobs[0].collection_scope?.kind).toBe("kubernetes_scope");
  });

  it("applyAgentHeartbeat reports lease_not_extended when instance_id does not match lease", () => {
    const s = insertSource(db, {
      display_name: "S",
      target_identifier: "host-hb-lease",
      source_type: "linux_host",
    });
    const { row: reg } = createAgentRegistration(db, s.id);
    const { row: job } = insertCollectionJob(db, s, {});
    const claim = claimCollectionJobForAgent(db, job.id, s.id, reg.id, "real-instance", 120);
    expect(claim.ok).toBe(true);

    const out = applyAgentHeartbeat(db, reg, s, {
      capabilities: ["collect:linux-audit-log"],
      attributes: {},
      agent_version: "1",
      active_job_id: job.id,
      instance_id: "wrong-instance",
    });

    expect(out.active_job_lease).toEqual({
      requested: true,
      job_id: job.id,
      extended: false,
      code: "lease_not_extended",
    });
  });
});
