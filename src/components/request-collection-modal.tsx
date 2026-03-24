"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  requestCollectionFromDashboardAction,
  type DashboardRequestCollectionState,
} from "@/app/sources/actions";

export interface DashboardCollectionSource {
  id: string;
  display_name: string;
  target_identifier: string;
  last_seen_at: string | null;
}

interface RequestCollectionModalProps {
  open: boolean;
  onClose: () => void;
  sources: DashboardCollectionSource[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "just now";
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

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="stroke-current/20" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 00-9-9"
        className="stroke-current"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RequestCollectionModal({
  open,
  onClose,
  sources,
}: RequestCollectionModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [selectedSourceId, setSelectedSourceId] = useState(sources[0]?.id ?? "");
  const [result, setResult] = useState<DashboardRequestCollectionState | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setSelectedSourceId(sources[0]?.id ?? "");
      setResult(null);
    }
  }, [open, sources]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null,
    [selectedSourceId, sources]
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleEscape);
      prev?.focus();
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-collection-title"
        className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-surface-container px-5 pt-5 pb-4">
          <div>
            <h2 id="request-collection-title" className="font-headline text-lg font-bold text-on-surface">
              Request collection
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Queue a collection job for a live source. A continuously running agent should claim it on its next poll.
              If the source only uses <code className="text-[10px] bg-surface-container px-1 py-0.5 rounded">once</code> or cron,
              the job waits until the next invocation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {result?.ok ? (
            <div className="space-y-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div>
                <p className="text-sm font-semibold text-on-surface">Collection job queued.</p>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {result.source_name} now has a queued job. A running agent should claim it shortly; one-shot or cron setups
                  will pick it up on the next run.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/sources/${result.source_id}?job=${result.job_id}`}
                  onClick={onClose}
                  className="rounded-lg bg-gradient-to-b from-primary to-primary-dim px-4 py-2 text-xs font-bold uppercase tracking-wider text-on-primary"
                >
                  Open source
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    reasonRef.current?.focus();
                  }}
                  className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-bold uppercase tracking-wider text-on-surface"
                >
                  Queue another
                </button>
              </div>
            </div>
          ) : (
            <form
              action={(formData) => {
                startTransition(() => {
                  void requestCollectionFromDashboardAction(formData).then(setResult);
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Live source
                </div>
                <input type="hidden" name="source_id" value={selectedSourceId} />
                <div className="space-y-2">
                  {sources.map((source) => {
                    const active = source.id === selectedSourceId;
                    return (
                      <button
                        key={source.id}
                        type="button"
                        onClick={() => setSelectedSourceId(source.id)}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition-all ${
                          active
                            ? "border-primary/40 bg-primary/[0.06] shadow-sm"
                            : "border-outline-variant/15 bg-surface-container-low hover:border-outline-variant/30 hover:bg-surface-container"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-on-surface">{source.display_name}</div>
                            <div className="mt-1 truncate text-xs font-mono text-on-surface-variant">
                              {source.target_identifier}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-primary">
                              online
                            </div>
                            <div className="mt-1 text-[10px] text-on-surface-variant">
                              seen {relativeTime(source.last_seen_at)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedSource ? (
                  <p className="text-[11px] leading-relaxed text-on-surface-variant">
                    {selectedSource.display_name} is the current target for this request.
                  </p>
                ) : null}
              </div>

              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Reason (optional)
                </span>
                <input
                  ref={reasonRef}
                  name="request_reason"
                  placeholder="e.g. pre-deploy check"
                  className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                />
              </label>

              {result && !result.ok ? (
                <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  {result.error === "admin_required" ? "Admin sign-in is required to queue jobs from the dashboard."
                  : result.error === "not_ready" ? "That source is no longer live and ready for collection."
                  : result.error === "disabled" ? "That source is disabled and cannot accept new jobs."
                  : result.error === "not_found" ? "That source no longer exists."
                  : "Choose a source to queue a collection job."}
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] leading-relaxed text-on-surface-variant">
                  Need setup help instead? Use <span className="font-semibold text-on-surface">How to collect</span> in the side rail.
                  For interactive use, keep the agent running continuously on the source machine.
                </p>
                <button
                  type="submit"
                  disabled={!selectedSource || isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-primary to-primary-dim px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary shadow-sm transition-all hover:brightness-110 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending ? (
                    <>
                      <Spinner className="h-3.5 w-3.5" />
                      Requesting…
                    </>
                  ) : (
                    "Request job"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
