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
    <section className="bg-surface-container-lowest border-b border-surface-container shadow-sm shrink-0">
      {(showToolbar || showGrid) && (
        <div className="flex items-center justify-between px-4 lg:px-6 py-2.5 border-b border-surface-container-low bg-surface-container-low/50">
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
            <span className="text-[10px] font-bold text-severity-critical uppercase tracking-widest truncate">
              {showGrid ? "Top Actions Now" : "Run actions"}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void onReanalyze?.()}
              disabled={!onReanalyze || reanalyzePending}
              aria-busy={reanalyzePending || undefined}
              className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant disabled:text-outline-variant disabled:cursor-not-allowed transition-colors"
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
            </button>
            {compareHref ? (
              <div className="flex items-center gap-0.5">
                <Link
                  href={compareHref}
                  className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant transition-colors"
                  title="Compare drift — implicit baseline is the latest older run for the same target (not always the reanalyze parent)"
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
                </Link>
                {compareToParentHref ? (
                  <Link
                    href={compareToParentHref}
                    className="px-1.5 py-0.5 text-[10px] font-semibold rounded hover:bg-surface-container-high text-primary whitespace-nowrap"
                    title="Compare to the run this was reanalyzed from (explicit baseline)"
                  >
                    vs parent
                  </Link>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onExport}
              disabled={!onExport}
              className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
            </button>
          </div>
        </div>
      )}

      {showGrid ? (
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-surface-container-low">
          {actions.map((action, i) => (
            <div key={i} className="flex gap-3 px-4 lg:px-5 py-3.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i === 0
                    ? "bg-severity-critical/10 text-severity-critical border border-severity-critical/20"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <p className="text-[13px] font-semibold text-on-surface leading-snug">{action}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
