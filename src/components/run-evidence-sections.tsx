"use client";

import type { RunEvidenceSection } from "@/lib/run-evidence-presentation";

interface RunEvidenceSectionsProps {
  sections: RunEvidenceSection[];
}

const toneClasses: Record<RunEvidenceSection["tone"], string> = {
  critical: "border-danger/30 bg-danger/[0.04]",
  warning: "border-warning/30 bg-warning/[0.05]",
  neutral: "border-outline-variant/15 bg-surface-container-low",
};

export function RunEvidenceSections({ sections }: RunEvidenceSectionsProps) {
  if (sections.length === 0) return null;

  return (
    <section className="rounded-lg border border-surface-container bg-surface-container-lowest shadow-sm">
      <div className="border-b border-surface-container bg-surface-container-low px-5 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Operational evidence
            </div>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Structured evidence extracted from the run so instability, rollout trouble, and runtime pressure are visible before you scan the full findings table.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-3">
        {sections.map((section) => (
          <article
            key={section.id}
            className={`rounded-xl border px-4 py-4 shadow-sm ${toneClasses[section.tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-outline-variant">
                  {section.title}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
                  {section.summary}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {section.entries.map((entry) => (
                <div
                  key={`${section.id}-${entry.label}-${entry.value}`}
                  className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-2"
                >
                  <div className="text-[9px] font-bold uppercase tracking-wider text-outline-variant">
                    {entry.label}
                  </div>
                  <div
                    className={`mt-1 text-[12px] leading-relaxed ${
                      entry.emphasis ? "font-semibold text-on-surface" : "text-on-surface-variant"
                    }`}
                  >
                    {entry.value}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
