import type { CollectionJobView } from "@/lib/storage/contract";

export const LEASE_LOST_ERROR_CODE = "lease_lost";
export const LEASE_LOST_ERROR_MESSAGE =
  "Lease expired while running; create a new job to retry.";

/**
 * Read-model projection for expired job leases.
 *
 * Mirrors reaper semantics for list/read surfaces without mutating storage:
 * - claimed + expired lease => queued (lease cleared)
 * - running + expired lease => expired (lease cleared, lease_lost metadata)
 */
export function projectCollectionJobLeaseReadModel(
  job: CollectionJobView,
  nowIso = new Date().toISOString()
): CollectionJobView {
  if (!job.lease_expires_at || job.lease_expires_at >= nowIso) return job;

  if (job.status === "claimed") {
    return {
      ...job,
      status: "queued",
      lease_owner_id: null,
      lease_owner_instance_id: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    };
  }

  if (job.status === "running") {
    return {
      ...job,
      status: "expired",
      error_code: job.error_code ?? LEASE_LOST_ERROR_CODE,
      error_message: job.error_message ?? LEASE_LOST_ERROR_MESSAGE,
      finished_at: job.finished_at ?? nowIso,
      lease_owner_id: null,
      lease_owner_instance_id: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    };
  }

  return job;
}
