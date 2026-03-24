import Link from "next/link";
import { AgentEnrollClient } from "./agent-enroll-client";
import { RequestJobForm } from "./request-job-form";
import { CancelJobButton } from "./cancel-job-button";
import { DeleteSourceButton } from "./delete-source-button";
import { SourceSettingsForm } from "./source-settings-form";
import { SourceHealthDot } from "@/components/source-health-dot";
import { JobStatusBadge, jobBorderClass } from "@/components/job-status-badge";
import { CopyTextButton } from "@/components/copy-text-button";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function shortTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function SourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string; error?: string; cancel_error?: string; delete_error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const storage = await getStorage();
  const source = await storage.sources.getById(id);
  if (!source) {
    return (
      <div className="text-on-surface-variant">
        Source not found. <Link href="/sources" className="underline">Back</Link>
      </div>
    );
  }
  const jobs = await storage.withTransaction(async (tx) => {
    await tx.jobs.reapExpiredLeases();
    return tx.jobs.listForSource(id);
  });
  const registration = await storage.agents.getRegistrationBySourceId(id);
  const blockingDeleteJobs = jobs.filter((job) => ["claimed", "running"].includes(job.status));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/sources" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All sources
        </Link>
        <div className="flex items-start justify-between gap-4 mt-3">
          <div className="min-w-0">
            <h1 className="font-headline text-2xl font-bold text-on-surface tracking-tight">{source.display_name}</h1>
            <p className="text-sm font-mono text-on-surface-variant mt-1 break-all">{source.target_identifier}</p>
          </div>
          <div className="shrink-0 pt-1">
            <SourceHealthDot status={source.health_status} size="lg" />
          </div>
        </div>
      </div>

      {/* Properties grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Type", value: source.source_type },
          { label: "Artifact", value: source.expected_artifact_type },
          {
            label: "Collector",
            value: `${source.default_collector_type}${source.default_collector_version ? ` @ ${source.default_collector_version}` : ""}`,
          },
          { label: "Last seen", value: relativeTime(source.last_seen_at) },
        ].map((prop) => (
          <div key={prop.label} className="relative overflow-hidden rounded-lg bg-surface-container-lowest p-3 shadow-sm">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/30" />
            <dt className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{prop.label}</dt>
            <dd className="text-sm font-medium text-on-surface mt-1 truncate">{prop.value}</dd>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {sp.error === "disabled" && (
        <p className="text-sm text-amber-800 dark:text-amber-200 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2.5">
          Source is disabled — enable it before requesting collection.
        </p>
      )}
      {sp.cancel_error && (
        <p className="text-sm text-red-700 dark:text-red-300 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5">
          Could not cancel job ({sp.cancel_error}).
        </p>
      )}
      {sp.delete_error === "active_jobs" && (
        <p className="text-sm text-red-700 dark:text-red-300 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5">
          Delete is blocked while this source has a claimed or running collection job.
        </p>
      )}

      {/* Collect Fresh Evidence */}
      <section className="relative rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm space-y-4 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/60 to-transparent" />
        <h2 className="font-headline text-lg font-bold text-on-surface tracking-tight">Collect Fresh Evidence</h2>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Creates a <strong>queued</strong> collection job. A thin external agent (enrolled below) must{" "}
          <strong>claim</strong> the job, run your collector, and upload the artifact.
          Collection runs <strong>outside</strong> SignalForge.
        </p>
        <RequestJobForm sourceId={id} enabled={source.enabled} />
      </section>

      {/* Agent enrollment */}
      <section className="relative rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm space-y-3 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-secondary via-secondary/40 to-transparent" />
        <h2 className="font-headline text-lg font-bold text-on-surface tracking-tight">Agent enrollment</h2>
        {registration ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Agent", value: registration.display_name || registration.id.slice(0, 8) + "…" },
                { label: "Last heartbeat", value: relativeTime(registration.last_heartbeat_at ?? null) },
                { label: "Agent version", value: registration.last_agent_version ?? "—" },
                { label: "Instance", value: registration.last_instance_id?.slice(0, 16) ?? "—" },
              ].map((prop) => (
                <div key={prop.label} className="rounded-lg bg-surface-container-low px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{prop.label}</dt>
                  <dd className="text-xs font-medium text-on-surface mt-0.5 truncate font-mono">{prop.value}</dd>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-on-surface-variant">
              One registration per source in v1. Token rotation is deferred.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-on-surface-variant">
              <span className="font-bold uppercase tracking-widest">Agent id</span>
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-on-surface">
                {registration.id}
              </code>
              <CopyTextButton
                value={registration.id}
                idleLabel="Copy agent id"
                className="rounded-md border border-outline-variant/20 bg-surface-container-low px-2 py-1 font-bold uppercase tracking-wider text-on-surface hover:bg-surface-container"
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-on-surface-variant">
              One agent token per source. Use <code className="text-[10px] font-mono bg-surface-container px-1.5 py-0.5 rounded">POST /api/agent/registrations</code> with
              admin auth, or enroll here.
            </p>
            <AgentEnrollClient sourceId={id} hasRegistration={false} />
          </>
        )}
      </section>

      {/* Collection jobs */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-lg font-bold text-on-surface tracking-tight">Collection jobs</h2>
          {jobs.length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
            </span>
          )}
        </div>
        {jobs.length === 0 ? (
          <div className="relative rounded-xl border border-dashed border-outline-variant/30 px-6 py-10 text-center overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-surface-container-low/30 to-transparent pointer-events-none" />
            <p className="relative text-sm text-on-surface-variant">No jobs yet. Request one above and an agent will claim it.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {jobs.map((j, i) => {
              const isHighlighted = sp.job === j.id;
              const isTerminal = ["submitted", "failed", "expired", "cancelled"].includes(j.status);
              return (
                <li
                  key={j.id}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className={`animate-[fadeIn_0.25s_ease_both] rounded-xl border-l-[3px] border border-outline-variant/20 p-4 shadow-sm transition-all hover:shadow-md ${jobBorderClass(j.status)} ${
                    isHighlighted ? "ring-1 ring-primary/30 bg-primary/[0.03]" : "bg-surface-container-lowest"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <JobStatusBadge status={j.status} />
                      <span className="text-[10px] text-on-surface-variant">{shortTimestamp(j.created_at)}</span>
                    </div>
                    <span className="font-mono text-[9px] text-outline-variant truncate select-all">{j.id}</span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant">
                    <span className="font-medium">{j.artifact_type}</span>
                    {j.request_reason && (
                      <span className="italic text-outline">"{j.request_reason}"</span>
                    )}
                    {j.result_run_id && (
                      <Link
                        href={`/runs/${j.result_run_id}`}
                        className="group/link inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        View run
                        <svg className="h-3 w-3 group-hover/link:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </Link>
                    )}
                    {j.result_analysis_status && (
                      <span className="text-[10px]">
                        analysis: <strong>{j.result_analysis_status}</strong>
                      </span>
                    )}
                  </div>

                  {j.error_code && (
                    <div className="mt-2.5 text-xs text-severity-critical bg-severity-critical/[0.06] border border-severity-critical/10 rounded-lg px-3 py-2">
                      <strong>{j.error_code}</strong>
                      {j.error_message ? `: ${j.error_message}` : ""}
                    </div>
                  )}

                  {!isTerminal && (
                    <div className="mt-3 pt-2.5 border-t border-outline-variant/15">
                      <CancelJobButton jobId={j.id} sourceId={id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Source settings */}
      <section className="relative rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm space-y-4 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-outline-variant/40 via-outline-variant/20 to-transparent" />
        <h2 className="font-headline text-lg font-bold text-on-surface tracking-tight">Source settings</h2>
        <SourceSettingsForm
          sourceId={id}
          displayName={source.display_name}
          collectorVersion={source.default_collector_version ?? null}
          enabled={source.enabled}
        />
        <div className="border-t border-outline-variant/15 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-on-surface">Danger zone</h3>
              <p className="text-xs leading-relaxed text-on-surface-variant">
                Deleting a source removes its agent registration and source-scoped collection jobs.
                Linked runs remain available.
                {jobs.length > 0 ? ` This source currently has ${jobs.length} stored job${jobs.length === 1 ? "" : "s"}.` : ""}
              </p>
              {blockingDeleteJobs.length > 0 && (
                <p className="text-xs text-severity-critical">
                  Delete is blocked until {blockingDeleteJobs.length} claimed or running job{blockingDeleteJobs.length === 1 ? "" : "s"} finish.
                </p>
              )}
            </div>
            <DeleteSourceButton sourceId={id} blocked={blockingDeleteJobs.length > 0} />
          </div>
        </div>
      </section>
    </div>
  );
}
