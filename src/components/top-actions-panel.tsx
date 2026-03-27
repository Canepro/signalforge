import Link from "next/link";

interface TopActionsPanelProps {
  actions: string[];
  onReanalyze?: () => void | Promise<void>;
  onExport?: () => void;
  /** Implicit baseline compare (`/runs/[id]/compare`). */
  compareHref?: string;
  /** Optional: explicit baseline (e.g. `?against=` reanalyze parent). Shown as a small “vs parent” link. */
  compareToParentHref?: string;
  /** When true, Reanalyze is in-flight (button disabled + busy state). */
  reanalyzePending?: boolean;
}

export function TopActionsPanel({
  actions,
  onReanalyze,
  onExport,
  compareHref,
  compareToParentHref,
  reanalyzePending,
}: TopActionsPanelProps) {
  const showToolbar = Boolean(onReanalyze || onExport || compareHref);
  const showGrid = actions.length > 0;
  if (!showToolbar && !showGrid) return null;

  return (
    <section className="shrink-0 border-b border-outline-variant/10 bg-surface-container-lowest shadow-sm">
      {(showToolbar || showGrid) && (
        <div className="flex flex-col gap-3 border-b border-outline-variant/10 bg-surface-container-low/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="h-3.5 w-3.5 text-severity-critical shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-severity-critical">
                {showGrid ? "Top Actions Now" : "Run actions"}
              </div>
              <p className="text-xs text-on-surface-variant">
                Reanalyze, compare, or export this run without relying on icon-only controls.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0" role="toolbar" aria-label="Run actions">
            {onReanalyze ? (
              <button
                type="button"
                onClick={() => void onReanalyze?.()}
                disabled={reanalyzePending}
                aria-busy={reanalyzePending || undefined}
                className="sf-btn-secondary"
                title={reanalyzePending ? "Reanalyzing…" : "Reanalyze artifact"}
              >
                {reanalyzePending ? (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeDasharray="32"
                      strokeLinecap="round"
                    />
                    <path
                      className="opacity-90"
                      d="M4 12a8 8 0 018-8"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                )}
                {reanalyzePending ? "Reanalyzing…" : "Reanalyze"}
              </button>
            ) : null}
            {compareHref ? (
              <>
                <Link
                  href={compareHref}
                  className="sf-btn-secondary"
                  title="Compare against the latest older run for the same target"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 7h12M8 12h12m-12 5h12M4 7h.01M4 12h.01M4 17h.01"
                    />
                  </svg>
                  Compare run
                </Link>
                {compareToParentHref ? (
                  <Link
                    href={compareToParentHref}
                    className="sf-btn-ghost px-3 py-2 text-primary"
                    title="Compare to the run this was reanalyzed from"
                  >
                    Compare vs parent
                  </Link>
                ) : null}
              </>
            ) : null}
            {onExport ? (
              <button
                type="button"
                onClick={onExport}
                className="sf-btn-ghost"
                title="Export report JSON"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Export JSON
              </button>
            ) : null}
          </div>
        </div>
      )}

      {showGrid ? (
        <div className="grid grid-cols-1 divide-y divide-surface-container-low md:grid-cols-3 md:divide-x md:divide-y-0">
          {actions.map((action, i) => (
            <div key={i} className="flex gap-3 px-4 py-4 lg:px-5">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                  i === 0
                    ? "bg-severity-critical/10 text-severity-critical border border-severity-critical/20"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <p className="text-sm font-semibold leading-snug text-on-surface">{action}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
