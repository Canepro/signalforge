import { describe, expect, it } from "vitest";
import {
  buildClaimLease,
  buildStartLeaseExpiryIso,
  normalizeAgentFailureInput,
  validateClaimCommand,
  validateFailCommand,
  validateStartCommand,
} from "@/lib/storage/shared/job-command-shared";

function baseJob(
  overrides: Partial<{
    source_id: string;
    status: string;
    lease_owner_id: string | null;
    lease_owner_instance_id: string | null;
    lease_expires_at: string | null;
  }> = {}
) {
  return {
    source_id: "source-1",
    status: "queued",
    lease_owner_id: null,
    lease_owner_instance_id: null,
    lease_expires_at: null,
    ...overrides,
  };
}

describe("job-command-shared", () => {
  it("validates claim preconditions and normalizes claim lease timing", () => {
    expect(
      validateClaimCommand(baseJob(), { sourceId: "source-1" })
    ).toEqual({ ok: true });

    expect(
      validateClaimCommand(baseJob({ status: "claimed" }), { sourceId: "source-1" })
    ).toEqual({ ok: false, code: "not_queued" });

    expect(
      validateClaimCommand(baseJob({ source_id: "source-2" }), { sourceId: "source-1" })
    ).toEqual({ ok: false, code: "wrong_source" });

    expect(
      buildClaimLease(30, "2026-04-06T12:00:00.000Z")
    ).toEqual({
      claimedAt: "2026-04-06T12:00:00.000Z",
      leaseExpiresAt: "2026-04-06T12:01:00.000Z",
    });

    expect(
      buildClaimLease(999, "2026-04-06T12:00:00.000Z")
    ).toEqual({
      claimedAt: "2026-04-06T12:00:00.000Z",
      leaseExpiresAt: "2026-04-06T12:05:00.000Z",
    });
  });

  it("validates start preconditions and extends the running lease window", () => {
    expect(
      validateStartCommand(
        baseJob({
          status: "claimed",
          lease_owner_id: "registration-1",
          lease_owner_instance_id: "instance-1",
          lease_expires_at: "2026-04-06T12:05:00.000Z",
        }),
        {
          sourceId: "source-1",
          registrationId: "registration-1",
          instanceId: "instance-1",
        },
        "2026-04-06T12:00:00.000Z"
      )
    ).toEqual({ ok: true });

    expect(
      validateStartCommand(
        baseJob({
          status: "claimed",
          lease_owner_id: "registration-1",
          lease_owner_instance_id: "instance-2",
          lease_expires_at: "2026-04-06T12:05:00.000Z",
        }),
        {
          sourceId: "source-1",
          registrationId: "registration-1",
          instanceId: "instance-1",
        },
        "2026-04-06T12:00:00.000Z"
      )
    ).toEqual({ ok: false, code: "wrong_lease" });

    expect(buildStartLeaseExpiryIso("2026-04-06T12:00:00.000Z")).toBe(
      "2026-04-06T12:05:00.000Z"
    );
  });

  it("validates fail preconditions and normalizes agent error payloads", () => {
    expect(
      validateFailCommand(
        baseJob({
          status: "running",
          lease_owner_id: "registration-1",
          lease_owner_instance_id: "instance-1",
          lease_expires_at: "2026-04-06T12:05:00.000Z",
        }),
        {
          sourceId: "source-1",
          registrationId: "registration-1",
          instanceId: "instance-1",
        },
        "2026-04-06T12:00:00.000Z"
      )
    ).toEqual({ ok: true });

    expect(
      validateFailCommand(
        baseJob({
          status: "submitted",
          lease_owner_id: "registration-1",
          lease_owner_instance_id: "instance-1",
          lease_expires_at: "2026-04-06T12:05:00.000Z",
        }),
        {
          sourceId: "source-1",
          registrationId: "registration-1",
          instanceId: "instance-1",
        },
        "2026-04-06T12:00:00.000Z"
      )
    ).toEqual({ ok: false, code: "bad_state" });

    expect(normalizeAgentFailureInput("  ", "  ")).toEqual({
      errorCode: "agent_failed",
      errorMessage: "failed",
    });
    expect(normalizeAgentFailureInput(" test_fail ", " test failure ")).toEqual({
      errorCode: "test_fail",
      errorMessage: "test failure",
    });
  });
});
