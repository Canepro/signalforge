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
    <div className="sf-panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-headline text-sm font-bold tracking-tight text-on-surface">
          Recent operational signals
        </h4>
        <p className="sf-kicker shrink-0">
          {highlights.length} {highlights.length === 1 ? "run" : "runs"}
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {highlights.map((highlight) => {
          const maxSections = highlight.sections.length > 3 ? 1 : 2;
          return (
            <Link
              key={highlight.run_id}
              href={`/runs/${highlight.run_id}`}
              className="block rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-150 hover:border-outline-variant/25 hover:bg-surface-container hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-on-surface">
                    {highlight.filename}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                    {highlight.target_name}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] font-medium text-on-surface-variant">
                  {highlight.created_at_label}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {highlight.sections.map((section) => (
                  <div
                    key={`${highlight.run_id}-${section.id}`}
                    className="rounded-md border border-outline-variant/10 bg-surface-container-lowest px-2 py-1.5"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                      {section.title}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {section.entries.slice(0, maxSections).map((entry) => (
                        <div key={`${section.id}-${entry.label}-${entry.value}`} className="text-xs leading-snug">
                          <span className="font-semibold text-on-surface">{entry.label}:</span>{" "}
                          <span className="text-on-surface-variant">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
