"use client";

import Link from "next/link";
import type { RunEvidenceSection } from "@/lib/run-evidence-presentation";

export interface DashboardOperationalHighlight {
  run_id: string;
  filename: string;
  target_name: string;
  created_at_label: string;
  sections: RunEvidenceSection[];
}

export function DashboardOperationalHighlights({
  highlights,
}: {
  highlights: DashboardOperationalHighlight[];
}) {
  if (highlights.length === 0) return null;

  return (
    <div className="sf-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-headline text-base font-bold tracking-tight text-on-surface">
            Recent operational signals
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
            High-signal rollout, pressure, runtime-health, and namespace-guardrail cues from the most important recent runs.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {highlights.map((highlight) => (
          <Link
            key={highlight.run_id}
            href={`/runs/${highlight.run_id}`}
            className="block rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 transition-[background-color,border-color,box-shadow] duration-150 hover:border-outline-variant/25 hover:bg-surface-container hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-on-surface">
                  {highlight.filename}
                </div>
                <div className="mt-1 line-clamp-2 break-all text-xs text-on-surface-variant">
                  {highlight.target_name}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px] font-medium text-on-surface-variant">
                {highlight.created_at_label}
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {highlight.sections.map((section) => (
                <div
                  key={`${highlight.run_id}-${section.id}`}
                  className="rounded-md border border-outline-variant/10 bg-surface-container-lowest px-2.5 py-2"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                    {section.title}
                  </div>
                  <div className="mt-1 space-y-1">
                    {section.entries.slice(0, 2).map((entry) => (
                      <div key={`${section.id}-${entry.label}-${entry.value}`} className="text-xs leading-relaxed">
                        <span className="font-semibold text-on-surface">{entry.label}:</span>{" "}
                        <span className="text-on-surface-variant">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
