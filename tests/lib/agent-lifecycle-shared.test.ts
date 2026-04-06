import { describe, expect, it } from "vitest";
import {
  buildHeartbeatLeaseExpiryIso,
  buildListNextQueuedJobsResult,
  mergeHeartbeatAttributesJson,
  normalizeHeartbeatAgentVersion,
  validateHeartbeatActiveJob,
  type QueuedJobSummary,
} from "@/lib/storage/shared/agent-lifecycle-shared";

function queuedJob(
  artifactType: string,
  overrides: Partial<QueuedJobSummary> = {}
): QueuedJobSummary {
  return {
    id: `${artifactType}-job`,
    source_id: "source-1",
    artifact_type: artifactType,
    status: "queued",
    created_at: "2026-04-06T10:00:00.000Z",
    request_reason: null,
    collection_scope: null,
    ...overrides,
  };
}

describe("agent-lifecycle-shared", () => {
  it("returns capability_mismatch when queued work exists but no shared collect capability matches", () => {
    expect(
      buildListNextQueuedJobsResult({
        sourceEnabled: true,
        lastHeartbeatAt: "2026-04-06T10:00:00.000Z",
        agentCapabilities: ["collect:linux-audit-log"],
        sourceCapabilities: ["collect:container-diagnostics"],
        queuedJobs: [queuedJob("container-diagnostics")],
        limit: 10,
      })
    ).toEqual({
      jobs: [],
      gate: "capability_mismatch",
    });
  });

  it("returns FIFO capability-compatible queued jobs", () => {
    const first = queuedJob("linux-audit-log", { id: "job-1" });
    const second = queuedJob("container-diagnostics", { id: "job-2" });
    const third = queuedJob("linux-audit-log", { id: "job-3" });

    expect(
      buildListNextQueuedJobsResult({
        sourceEnabled: true,
        lastHeartbeatAt: "2026-04-06T10:00:00.000Z",
        agentCapabilities: ["collect:linux-audit-log", "collect:container-diagnostics"],
        sourceCapabilities: ["collect:linux-audit-log"],
        queuedJobs: [first, second, third],
        limit: 2,
      })
    ).toEqual({
      jobs: [first, third],
      gate: null,
    });
  });

  it("validates heartbeat active-job ownership, instance, and lease state", () => {
    const activeJob = {
      source_id: "source-1",
      status: "running",
      error_code: null,
      lease_owner_id: "registration-1",
      lease_owner_instance_id: "instance-1",
      lease_expires_at: "2026-04-06T12:05:00.000Z",
      claimed_at: "2026-04-06T11:45:00.000Z",
    };

    expect(
      validateHeartbeatActiveJob(activeJob, {
        sourceId: "source-1",
        registrationId: "registration-1",
        instanceId: "instance-1",
      }, "2026-04-06T12:00:00.000Z")
    ).toEqual({ ok: true });

    expect(
      validateHeartbeatActiveJob(activeJob, {
        sourceId: "source-1",
        registrationId: "registration-1",
        instanceId: "instance-2",
      }, "2026-04-06T12:00:00.000Z")
    ).toEqual({ ok: false, code: "instance_mismatch" });

    expect(
      validateHeartbeatActiveJob(
        {
          ...activeJob,
          status: "expired",
          error_code: "lease_lost",
        },
        {
          sourceId: "source-1",
          registrationId: "registration-1",
          instanceId: "instance-1",
        },
        "2026-04-06T12:00:00.000Z"
      )
    ).toEqual({ ok: false, code: "lease_expired" });
  });

  it("extends heartbeat leases from the current expiry but caps at 30 minutes after claim", () => {
    expect(
      buildHeartbeatLeaseExpiryIso(
        {
          lease_expires_at: "2026-04-06T12:05:00.000Z",
          claimed_at: "2026-04-06T11:45:00.000Z",
        },
        Date.parse("2026-04-06T12:00:00.000Z")
      )
    ).toBe("2026-04-06T12:07:00.000Z");

    expect(
      buildHeartbeatLeaseExpiryIso(
        {
          lease_expires_at: "2026-04-06T12:14:00.000Z",
          claimed_at: "2026-04-06T11:45:00.000Z",
        },
        Date.parse("2026-04-06T12:00:00.000Z")
      )
    ).toBe("2026-04-06T12:15:00.000Z");
  });

  it("normalizes heartbeat write payloads", () => {
    expect(mergeHeartbeatAttributesJson('{"region":"uksouth"}', { role: "worker" })).toBe(
      '{"region":"uksouth","role":"worker"}'
    );
    expect(mergeHeartbeatAttributesJson("{bad-json", { role: "worker" })).toBe(
      '{"role":"worker"}'
    );
    expect(normalizeHeartbeatAgentVersion(" 1.2.3 ")).toBe("1.2.3");
    expect(normalizeHeartbeatAgentVersion("   ")).toBeNull();
  });
});
