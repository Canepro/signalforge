"use client";

import Link from "next/link";
import type { DashboardOperationalWatchLane } from "@/lib/dashboard-operational-watch";

const toneClasses: Record<DashboardOperationalWatchLane["tone"], string> = {
  critical: "border-danger/20 bg-danger/[0.03]",
  warning: "border-warning/20 bg-warning/[0.04]",
  neutral: "border-outline-variant/15 bg-surface-container-low",
};

const badgeClasses: Record<DashboardOperationalWatchLane["tone"], string> = {
  critical: "border-danger/25 bg-danger/[0.08] text-danger",
  warning: "border-warning/25 bg-warning/[0.10] text-warning",
  neutral: "border-outline-variant/20 bg-surface-container text-on-surface-variant",
};

export function DashboardOperationalWatch({
  lanes,
}: {
  lanes: DashboardOperationalWatchLane[];
}) {
  if (lanes.length === 0) return null;

  return (
    <section className="sf-panel p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h4 className="font-headline text-base font-bold tracking-tight text-on-surface">
            Operational Watch
          </h4>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-on-surface-variant">
            Fleet-level signals from the most recent attention-worthy runs. Use this to see where failure evidence, rollout drag, quota pressure, or storage pressure are clustering before drilling into individual runs.
          </p>
        </div>
        <p className="sf-kicker">
          Recent cross-run signals
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {lanes.map((lane) => (
          <article
            key={lane.id}
            className={`rounded-xl border px-4 py-4 shadow-sm ${toneClasses[lane.tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="sf-kicker text-outline-variant">
                  {lane.title}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                  {lane.summary}
                </p>
              </div>
              <div
                className={`shrink-0 rounded-md border px-2.5 py-2 text-center ${badgeClasses[lane.tone]}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                  Runs
                </div>
                <div className="mt-0.5 text-lg font-bold leading-none">
                  {lane.run_count}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {lane.items.map((item) => (
                <Link
                  key={`${lane.id}-${item.run_id}-${item.label}`}
                  href={`/runs/${item.run_id}`}
                  className="block rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-3 transition-[background-color,border-color,box-shadow] duration-150 hover:border-outline-variant/20 hover:bg-surface-container hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-on-surface">
                        {item.label}
                      </div>
                      <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-on-surface-variant">
                        {item.detail}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] font-medium text-on-surface-variant">
                      {item.created_at_label}
                    </div>
                  </div>
                  <div className="mt-2 break-all text-xs text-outline-variant">
                    {item.target_name}
                  </div>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
