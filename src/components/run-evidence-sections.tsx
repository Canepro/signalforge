"use client";

import type { RunEvidenceSection } from "@/lib/run-evidence-presentation";

interface RunEvidenceSectionsProps {
  sections: RunEvidenceSection[];
  heading?: string;
  description?: string;
}

const toneClasses: Record<RunEvidenceSection["tone"], string> = {
  critical: "border-danger/30 bg-danger/[0.04]",
  warning: "border-warning/30 bg-warning/[0.05]",
  neutral: "border-outline-variant/15 bg-surface-container-low",
};

export function RunEvidenceSections({
  sections,
  heading = "Operational evidence",
  description = "Structured evidence extracted from the run so instability, rollout trouble, runtime pressure, and missing guardrails are visible before you scan the full findings table.",
}: RunEvidenceSectionsProps) {
  if (sections.length === 0) return null;

  return (
    <section className="sf-panel">
      <div className="sf-panel-header">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="sf-kicker">
              {heading}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-4 lg:grid-cols-3">
        {sections.map((section) => (
          <article
            key={section.id}
            className={`rounded-xl border px-3 py-3 shadow-sm ${toneClasses[section.tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="sf-kicker text-outline-variant">
                  {section.title}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                  {section.summary}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {section.entries.map((entry) => (
                <div
                  key={`${section.id}-${entry.label}-${entry.value}`}
                  className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-2.5 py-1.5"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
                    {entry.label}
                  </div>
                  <div
                    className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${
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
