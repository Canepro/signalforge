"use client";

import { useState } from "react";
import { SeverityBadge } from "./severity-badge";
import type { Finding } from "@/lib/analyzer/schema";

interface FindingsTableProps {
  findings: Finding[];
}

export function FindingsTable({ findings }: FindingsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (findings.length === 0) {
    return (
      <div className="rounded-lg bg-surface-container-lowest px-6 py-10 text-center text-sm text-outline-variant shadow-sm">
        No findings for this run.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-surface-container bg-surface-container-lowest shadow-sm flex flex-col">
      <div className="px-5 py-3 bg-surface-container-low border-b border-surface-container flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Findings
        </h3>
        <span className="text-[10px] font-bold text-outline-variant">
          {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </span>
      </div>
      <div className="divide-y divide-surface-container-low">
        {findings.map((f) => {
          const isExpanded = expandedId === f.id;
          return (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              className="hover:bg-surface-container-low/30 transition-colors cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedId(isExpanded ? null : f.id);
                }
              }}
            >
              {/* Primary row */}
              <div className="flex gap-4 px-5 py-3.5">
                {/* Severity */}
                <div className="w-20 shrink-0 pt-0.5">
                  <SeverityBadge severity={f.severity} />
                </div>

                {/* Issue & Category */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-on-surface leading-snug">
                    {f.title}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-outline-variant mt-0.5">
                    {f.category}
                  </div>
                </div>

                {/* Evidence — visible on larger screens inline */}
                <div className="hidden lg:block w-2/5 shrink-0">
                  <div className="rounded border border-surface-container bg-surface-container-low px-2.5 py-1.5 font-mono text-[10px] text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words">
                    {f.evidence.length > 140
                      ? f.evidence.slice(0, 140) + "…"
                      : f.evidence}
                  </div>
                </div>

                {/* Expand indicator */}
                <div className="shrink-0 pt-0.5">
                  <svg
                    className={`h-4 w-4 text-outline-variant transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-5 pb-4 pt-0 ml-24 space-y-3">
                  {/* Evidence (shown here on small screens, always shown expanded for full text) */}
                  <div>
                    <div className="text-[9px] font-bold uppercase text-outline-variant mb-1">
                      Evidence Excerpt
                    </div>
                    <div className="rounded border border-surface-container bg-surface-container-low px-3 py-2 font-mono text-[11px] text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words">
                      {f.evidence}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-[9px] font-bold uppercase text-outline-variant mb-1">
                        Why It Matters
                      </div>
                      <p className="text-xs text-on-surface-variant leading-relaxed">
                        {f.why_it_matters}
                      </p>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase text-outline-variant mb-1">
                        Recommended Action
                      </div>
                      <p className="text-xs text-on-surface-variant leading-relaxed">
                        {f.recommended_action}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
