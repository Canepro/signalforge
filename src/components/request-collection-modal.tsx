"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  requestCollectionFromDashboardAction,
  type DashboardRequestCollectionState,
} from "@/app/sources/actions";
import { CollectionScopeFields } from "@/app/sources/collection-scope-fields";
import {
  detailCollectionScope,
  summarizeCollectionScope,
  type CollectionScope,
} from "@/lib/collection-scope";
import { getArtifactTypeLabel, type ArtifactType } from "@/lib/source-catalog";
import { ModalShell } from "./modal-shell";

export interface DashboardCollectionSource {
  id: string;
  display_name: string;
  target_identifier: string;
  expected_artifact_type: ArtifactType;
  last_seen_at: string | null;
  default_collection_scope: CollectionScope | null;
}

interface RequestCollectionModalProps {
  open: boolean;
  onClose: () => void;
  sources: DashboardCollectionSource[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "unknown";
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

function ScopeSummary({
  scope,
}: {
  scope: CollectionScope | null;
}) {
  if (!scope) {
    return (
      <p className="text-xs leading-relaxed text-on-surface-variant">
        This source has no stored default scope. Leaving the override blank will queue the job without an explicit scope payload.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-on-surface-variant">
        This source defaults to <span className="font-semibold text-on-surface">{summarizeCollectionScope(scope)}</span>.
        Leave the override blank to inherit that stored scope for this request.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {detailCollectionScope(scope).map((item) => (
          <span
            key={item}
            className="rounded-lg bg-surface-container px-2 py-1 text-[11px] font-mono text-on-surface-variant"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RequestCollectionModal({
  open,
  onClose,
  sources,
}: RequestCollectionModalProps) {
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

  if (!open) return null;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId="request-collection-title"
      maxWidthClassName="max-w-4xl"
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/15 px-5 pb-4 pt-5">
        <div>
          <h2 id="request-collection-title" className="font-headline text-xl font-bold tracking-tight text-on-surface">
            Request collection
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
            Queue a collection job for a live source. A continuously running agent should claim it on its next poll.
            If the source only uses <code className="sf-inline-code">once</code> or cron, the job waits until the next invocation.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="sf-btn-icon h-10 w-10 shrink-0"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-5 px-5 py-5">
        {result?.ok ? (
          <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div>
              <p className="text-base font-semibold text-on-surface">Collection job queued.</p>
              <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                {result.source_name} now has a queued job. A running agent should claim it shortly; one-shot or cron setups
                will pick it up on the next run.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/sources/${result.source_id}?job=${result.job_id}`}
                onClick={onClose}
                className="sf-btn-primary"
              >
                Open source
              </Link>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  reasonRef.current?.focus();
                }}
                className="sf-btn-secondary"
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
            className="space-y-5"
          >
            <input type="hidden" name="source_id" value={selectedSourceId} />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
              <div className="space-y-3">
                <div>
                  <div className="sf-kicker">Live source</div>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                    Pick the target that should receive this job. Selection is both visual and semantic.
                  </p>
                </div>
                <div
                  className="space-y-2"
                  role="radiogroup"
                  aria-label="Live sources available for collection"
                >
                  {sources.map((source) => {
                    const active = source.id === selectedSourceId;
                    return (
                      <button
                        key={source.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedSourceId(source.id)}
                        className={`sf-select-card w-full ${active ? "border-primary/35 bg-primary/[0.07] shadow-sm" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-on-surface">{source.display_name}</div>
                            <div className="mt-1 truncate text-xs font-mono text-on-surface-variant">
                              {source.target_identifier}
                            </div>
                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                              {getArtifactTypeLabel(source.expected_artifact_type)}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                              online
                            </div>
                            <div className="mt-1 text-[11px] text-on-surface-variant">
                              last seen {relativeTime(source.last_seen_at)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                {selectedSource ? (
                  <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                    <div className="sf-kicker">Resolved target</div>
                    <div className="mt-2 text-base font-semibold text-on-surface">
                      {selectedSource.display_name}
                    </div>
                    <div className="mt-1 break-all text-sm font-mono text-on-surface-variant">
                      {selectedSource.target_identifier}
                    </div>
                    <div className="mt-3 rounded-xl border border-outline-variant/15 bg-surface-container-lowest px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                        Scope and artifact family
                      </div>
                      <div className="mt-1 text-sm text-on-surface">
                        {getArtifactTypeLabel(selectedSource.expected_artifact_type)}
                      </div>
                      <div className="mt-2">
                        <ScopeSummary scope={selectedSource.default_collection_scope} />
                      </div>
                    </div>
                  </div>
                ) : null}

                <label className="block">
                  <span className="sf-field-label">Reason (optional)</span>
                  <input
                    ref={reasonRef}
                    name="request_reason"
                    placeholder="e.g. pre-deploy check"
                    className="sf-field"
                  />
                </label>

                {selectedSource ? (
                  <CollectionScopeFields
                    key={`${selectedSource.id}:${selectedSource.expected_artifact_type}`}
                    artifactType={selectedSource.expected_artifact_type}
                    prefix="collection_scope"
                    emptyLabel="Use source default / no override"
                    caption={
                      selectedSource.default_collection_scope
                        ? "Optional. Leave blank to inherit the stored source default scope, or override it for this one dashboard request."
                        : "Optional. Leave blank to queue the job without an explicit scope payload."
                    }
                  />
                ) : null}
              </div>
            </div>

            {result && !result.ok ? (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                {result.error === "admin_required" ? "Admin sign-in is required to queue jobs from the dashboard."
                : result.error === "not_ready" ? "That source is no longer live and ready for collection."
                : result.error === "disabled" ? "That source is disabled and cannot accept new jobs."
                : result.error === "not_found" ? "That source no longer exists."
                : result.error === "invalid_collection_scope" ? "The chosen collection scope does not match this source's artifact family."
                : "Choose a source to queue a collection job."}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-outline-variant/10 pt-4 lg:flex-row lg:items-end lg:justify-between">
              <p className="max-w-2xl text-xs leading-relaxed text-on-surface-variant">
                Need setup help instead? Use <span className="font-semibold text-on-surface">How to collect</span> in the shell.
                For interactive use, keep the agent running continuously on the source machine so queued jobs are claimed promptly.
              </p>
              <button
                type="submit"
                disabled={!selectedSource || isPending}
                className="sf-btn-primary"
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
    </ModalShell>
  );
}
