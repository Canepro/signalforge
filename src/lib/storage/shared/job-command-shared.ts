export type ClaimableJobState = {
  source_id: string;
  status: string;
};

export function validateClaimCommand(
  job: ClaimableJobState,
  input: { sourceId: string }
): { ok: true } | { ok: false; code: "wrong_source" | "not_queued" } {
  if (job.source_id !== input.sourceId) {
    return { ok: false, code: "wrong_source" };
  }
  if (job.status !== "queued") {
    return { ok: false, code: "not_queued" };
  }
  return { ok: true };
}

export function buildClaimLease(leaseTtlSeconds: number, nowIso = new Date().toISOString()) {
  const ttl = Math.min(300, Math.max(60, Math.floor(leaseTtlSeconds)));
  const nowMs = new Date(nowIso).getTime();
  return {
    claimedAt: nowIso,
    leaseExpiresAt: new Date(nowMs + ttl * 1000).toISOString(),
  };
}

export type LeaseOwnedJobState = {
  source_id: string;
  status: string;
  lease_owner_id: string | null;
  lease_owner_instance_id: string | null;
  lease_expires_at: string | null;
};

export function validateStartCommand(
  job: LeaseOwnedJobState,
  input: {
    sourceId: string;
    registrationId: string;
    instanceId: string;
  },
  nowIso = new Date().toISOString()
): { ok: true } | { ok: false; code: "wrong_job" | "not_claimed" | "lease_expired" | "wrong_lease" } {
  if (job.source_id !== input.sourceId) {
    return { ok: false, code: "wrong_job" };
  }
  if (job.status !== "claimed") {
    return { ok: false, code: "not_claimed" };
  }
  if (
    job.lease_owner_id !== input.registrationId
    || job.lease_owner_instance_id !== input.instanceId
  ) {
    return { ok: false, code: "wrong_lease" };
  }
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return { ok: false, code: "lease_expired" };
  }
  return { ok: true };
}

export function buildStartLeaseExpiryIso(nowIso = new Date().toISOString()) {
  return new Date(new Date(nowIso).getTime() + 300_000).toISOString();
}

export function validateFailCommand(
  job: LeaseOwnedJobState,
  input: {
    sourceId: string;
    registrationId: string;
    instanceId: string;
  },
  nowIso = new Date().toISOString()
): { ok: true } | { ok: false; code: "wrong_job" | "bad_state" | "lease_expired" | "wrong_lease" } {
  if (job.source_id !== input.sourceId) {
    return { ok: false, code: "wrong_job" };
  }
  if (job.status !== "claimed" && job.status !== "running") {
    return { ok: false, code: "bad_state" };
  }
  if (
    job.lease_owner_id !== input.registrationId
    || job.lease_owner_instance_id !== input.instanceId
  ) {
    return { ok: false, code: "wrong_lease" };
  }
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return { ok: false, code: "lease_expired" };
  }
  return { ok: true };
}

export function normalizeAgentFailureInput(errorCode: string, errorMessage: string) {
  return {
    errorCode: errorCode.trim().slice(0, 128) || "agent_failed",
    errorMessage: errorMessage.trim().slice(0, 2048) || "failed",
  };
}
