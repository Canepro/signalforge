import type { CollectionScope } from "@/lib/collection-scope";
import { collectCapabilityForArtifactType } from "@/lib/source-catalog";

export type JobsNextGate =
  | "source_disabled"
  | "heartbeat_required"
  | "capabilities_empty"
  | "capability_mismatch";

export type QueuedJobSummary = {
  id: string;
  source_id: string;
  artifact_type: string;
  status: string;
  created_at: string;
  request_reason: string | null;
  collection_scope: CollectionScope | null;
};

export function buildListNextQueuedJobsResult(input: {
  sourceEnabled: boolean;
  lastHeartbeatAt: string | null | undefined;
  agentCapabilities: string[];
  sourceCapabilities: string[];
  queuedJobs: QueuedJobSummary[];
  limit: number;
}): {
  jobs: QueuedJobSummary[];
  gate: JobsNextGate | null;
} {
  if (!input.sourceEnabled) {
    return { jobs: [], gate: "source_disabled" };
  }

  if (!input.lastHeartbeatAt) {
    return { jobs: [], gate: "heartbeat_required" };
  }

  if (input.agentCapabilities.length === 0) {
    return { jobs: [], gate: "capabilities_empty" };
  }

  const sharedCapabilities = new Set(
    input.agentCapabilities.filter((capability) => input.sourceCapabilities.includes(capability))
  );

  const eligibleJobs = input.queuedJobs.filter((job) =>
    sharedCapabilities.has(collectCapabilityForArtifactType(job.artifact_type))
  );

  if (eligibleJobs.length === 0 && input.queuedJobs.length > 0) {
    return { jobs: [], gate: "capability_mismatch" };
  }

  const limit = Math.max(0, Math.floor(input.limit));
  return { jobs: eligibleJobs.slice(0, limit), gate: null };
}

export type HeartbeatActiveJobState = {
  source_id: string;
  status: string;
  error_code: string | null;
  lease_owner_id: string | null;
  lease_owner_instance_id: string | null;
  lease_expires_at: string | null;
  claimed_at: string | null;
};

export function validateHeartbeatActiveJob(
  job: HeartbeatActiveJobState,
  input: {
    sourceId: string;
    registrationId: string;
    instanceId: string | null;
  },
  nowIso = new Date().toISOString()
):
  | { ok: true }
  | {
      ok: false;
      code:
        | "forbidden"
        | "invalid_active_job_state"
        | "invalid_state"
        | "instance_mismatch"
        | "lease_expired";
    } {
  if (job.source_id !== input.sourceId) {
    return { ok: false, code: "forbidden" };
  }
  if (job.status === "expired" && job.error_code === "lease_lost") {
    return { ok: false, code: "lease_expired" };
  }
  if (job.lease_owner_id !== input.registrationId) {
    return { ok: false, code: "forbidden" };
  }
  if (job.status !== "claimed" && job.status !== "running") {
    return { ok: false, code: "invalid_active_job_state" };
  }
  if (!job.lease_owner_instance_id) {
    return { ok: false, code: "invalid_state" };
  }
  if (job.lease_owner_instance_id !== input.instanceId) {
    return { ok: false, code: "instance_mismatch" };
  }
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return { ok: false, code: "lease_expired" };
  }
  return { ok: true };
}

/** Extend lease by 120s from max(now, current expiry), capped 30m after claim. */
export function buildHeartbeatLeaseExpiryIso(
  job: Pick<HeartbeatActiveJobState, "lease_expires_at" | "claimed_at">,
  nowMs: number
): string {
  const extendMs = 120_000;
  const leaseEnd =
    job.lease_expires_at ? new Date(job.lease_expires_at).getTime() : nowMs;
  const base = Math.max(nowMs, leaseEnd);
  let next = base + extendMs;
  if (job.claimed_at) {
    const cap = new Date(job.claimed_at).getTime() + 30 * 60_000;
    next = Math.min(next, cap);
  }
  return new Date(next).toISOString();
}

export function mergeHeartbeatAttributesJson(
  existingAttributesJson: string | null | undefined,
  attributes: Record<string, unknown>
): string {
  try {
    const previous = JSON.parse(existingAttributesJson || "{}") as Record<string, unknown>;
    return JSON.stringify({ ...previous, ...attributes });
  } catch {
    return JSON.stringify(attributes);
  }
}

export function normalizeHeartbeatAgentVersion(agentVersion: string): string | null {
  return agentVersion.trim() || null;
}
