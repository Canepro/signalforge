/**
 * Internal domain events — structured logging only (no webhooks).
 * Future: bus, `events` table, notification consumers.
 */

export type DomainEventName =
  | "source.registered"
  | "source.deleted"
  | "source.health_changed"
  | "collection_job.requested"
  | "collection_job.claimed"
  | "collection_job.running"
  | "collection_job.submitted"
  | "collection_job.failed"
  | "collection_job.cancelled"
  | "collection_job.lease_lost"
  | "collection_job.expired"
  | "run.created"
  | "run.completed"
  | "run.failed";

export interface RunLifecycleEventInput {
  run_id: string;
  artifact_id: string;
  status: string;
  analysis_error?: string | null;
  source_id?: string;
  job_id?: string;
  parent_run_id?: string;
  occurred_at?: string;
}

const healthThrottleMs = 60_000;
const lastHealthEmit = new Map<string, number>();

export function emitDomainEvent(
  name: DomainEventName,
  payload: Record<string, unknown>
): void {
  if (process.env.NODE_ENV === "test") return;

  if (name === "source.health_changed") {
    const sid = String(payload.source_id ?? "");
    if (sid) {
      const now = Date.now();
      const prev = lastHealthEmit.get(sid) ?? 0;
      if (now - prev < healthThrottleMs) return;
      lastHealthEmit.set(sid, now);
    }
  }

  try {
    // eslint-disable-next-line no-console -- intentional lightweight boundary
    console.info(`[signalforge:event] ${name}`, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function emitRunLifecycleEvents(input: RunLifecycleEventInput): void {
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const shared = {
    run_id: input.run_id,
    occurred_at: occurredAt,
    ...(input.source_id ? { source_id: input.source_id } : {}),
    ...(input.job_id ? { job_id: input.job_id } : {}),
    ...(input.parent_run_id ? { parent_run_id: input.parent_run_id } : {}),
  };

  emitDomainEvent("run.created", {
    ...shared,
    artifact_id: input.artifact_id,
  });

  if (input.status === "complete") {
    emitDomainEvent("run.completed", shared);
    return;
  }

  emitDomainEvent("run.failed", {
    ...shared,
    error: input.analysis_error ?? input.status,
  });
}
