import { describe, expect, it } from "vitest";
import type { CollectionJobView } from "@/lib/storage/contract";
import {
  LEASE_LOST_ERROR_CODE,
  LEASE_LOST_ERROR_MESSAGE,
  projectCollectionJobLeaseReadModel,
} from "@/lib/storage/shared/job-read-model";

function baseJob(overrides: Partial<CollectionJobView> = {}): CollectionJobView {
  return {
    id: "job-1",
    source_id: "source-1",
    artifact_type: "linux-audit-log",
    status: "queued",
    requested_by: "operator",
    request_reason: null,
    priority: 0,
    idempotency_key: null,
    lease_owner_id: null,
    lease_owner_instance_id: null,
    lease_expires_at: null,
    last_heartbeat_at: null,
    result_artifact_id: null,
    result_run_id: null,
    error_code: null,
    error_message: null,
    created_at: "2026-04-06T10:00:00.000Z",
    updated_at: "2026-04-06T10:00:00.000Z",
    queued_at: "2026-04-06T10:00:00.000Z",
    claimed_at: null,
    started_at: null,
    submitted_at: null,
    finished_at: null,
    result_analysis_status: null,
    collection_scope: null,
    ...overrides,
  };
}

describe("projectCollectionJobLeaseReadModel", () => {
  it("keeps non-expired jobs unchanged", () => {
    const now = "2026-04-06T12:00:00.000Z";
    const job = baseJob({
      status: "claimed",
      lease_owner_id: "agent-1",
      lease_owner_instance_id: "i-1",
      lease_expires_at: "2026-04-06T12:05:00.000Z",
    });

    expect(projectCollectionJobLeaseReadModel(job, now)).toEqual(job);
  });

  it("projects expired claimed jobs back to queued without mutating persistence", () => {
    const now = "2026-04-06T12:00:00.000Z";
    const job = baseJob({
      status: "claimed",
      lease_owner_id: "agent-1",
      lease_owner_instance_id: "i-1",
      lease_expires_at: "2026-04-06T11:59:00.000Z",
      last_heartbeat_at: "2026-04-06T11:58:00.000Z",
      claimed_at: "2026-04-06T11:30:00.000Z",
    });

    expect(projectCollectionJobLeaseReadModel(job, now)).toEqual({
      ...job,
      status: "queued",
      lease_owner_id: null,
      lease_owner_instance_id: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    });
  });

  it("projects expired running jobs to expired with lease_lost defaults", () => {
    const now = "2026-04-06T12:00:00.000Z";
    const job = baseJob({
      status: "running",
      lease_owner_id: "agent-1",
      lease_owner_instance_id: "i-1",
      lease_expires_at: "2026-04-06T11:59:00.000Z",
      started_at: "2026-04-06T11:40:00.000Z",
    });

    expect(projectCollectionJobLeaseReadModel(job, now)).toEqual({
      ...job,
      status: "expired",
      error_code: LEASE_LOST_ERROR_CODE,
      error_message: LEASE_LOST_ERROR_MESSAGE,
      finished_at: now,
      lease_owner_id: null,
      lease_owner_instance_id: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    });
  });

  it("preserves existing error and finished_at when projecting expired running jobs", () => {
    const now = "2026-04-06T12:00:00.000Z";
    const job = baseJob({
      status: "running",
      lease_owner_id: "agent-1",
      lease_owner_instance_id: "i-1",
      lease_expires_at: "2026-04-06T11:59:00.000Z",
      error_code: "collector_timeout",
      error_message: "Collector exceeded timeout",
      finished_at: "2026-04-06T11:59:30.000Z",
    });

    expect(projectCollectionJobLeaseReadModel(job, now)).toEqual({
      ...job,
      status: "expired",
      lease_owner_id: null,
      lease_owner_instance_id: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    });
  });
});
