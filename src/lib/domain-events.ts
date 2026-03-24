/**
 * Internal domain events — structured logging only (no webhooks).
 * Future: bus, `events` table, notification consumers.
 */

export type DomainEventName =
  | "source.registered"
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
