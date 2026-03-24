"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import type { FindingsDriftResult } from "@/lib/compare/findings-diff";

export interface CompareRunHeader {
  id: string;
  filename: string;
  created_at_label: string;
  target_name: string | null;
}

interface CompareClientProps {
  current: CompareRunHeader;
  baseline: CompareRunHeader | null;
  drift: FindingsDriftResult;
  targetMismatch?: boolean;
  baselineMissing?: boolean;
}

function statusLabel(s: FindingsDriftResult["rows"][0]["status"]): string {
  switch (s) {
    case "new":
      return "New";
    case "resolved":
      return "Resolved";
    case "severity_up":
      return "Severity ↑";
    case "severity_down":
      return "Severity ↓";
    default:
      return s;
  }
}

function statusPillClass(s: FindingsDriftResult["rows"][0]["status"]): string {
  switch (s) {
    case "new":
      return "bg-red-50 text-red-800 border-red-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "severity_up":
      return "bg-orange-50 text-orange-800 border-orange-200";
    case "severity_down":
      return "bg-sky-50 text-sky-800 border-sky-200";
    default:
      return "bg-surface-container-high text-on-surface-variant";
  }
}

function evidenceSnippet(text: string | null, max = 160): string {
  if (!text) return "—";
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function CompareClient({
  current,
  baseline,
  drift,
  targetMismatch,
  baselineMissing,
}: CompareClientProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);

  const title = useMemo(
    () =>
      baseline
        ? `Drift: ${baseline.filename} → ${current.filename}`
        : "Compare runs",
    [baseline, current.filename]
  );

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        onUploadClick={() => setUploadOpen(true)}
        onCollectEvidenceClick={() => setCollectOpen(true)}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CollectEvidenceModal open={collectOpen} onClose={() => setCollectOpen(false)} />

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          breadcrumb={
            <>
              <Link href="/" className="hover:text-primary transition-colors">
                Runs
              </Link>
              <span className="text-outline-variant">/</span>
              <Link
                href={`/runs/${current.id}`}
                className="hover:text-primary transition-colors truncate max-w-[140px]"
              >
                {current.filename}
              </Link>
              <span className="text-outline-variant">/</span>
              <span className="text-on-surface font-semibold">Compare</span>
            </>
          }
        />

        <main className="flex-1 overflow-y-auto bg-surface text-on-surface">
          <div className="border-b border-outline-variant/20 bg-surface-container-lowest/80 px-4 lg:px-6 py-4">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
              <div>
                <h1 className="font-headline text-lg font-bold tracking-tight">
                  {title}
                </h1>
                <p className="text-xs text-on-surface-variant mt-1 max-w-2xl">
                  Diff-style review of normalized findings (category + normalized title +
                  section_source). <span className="text-on-surface">Implicit baseline</span> is the{" "}
                  <strong className="font-semibold text-on-surface">latest older run</strong> for the
                  same logical target (identifier first, else hostname, else same artifact)—not
                  necessarily a reanalyze parent. Use{" "}
                  <code className="font-mono text-[10px] bg-surface-container-high px-1 rounded">
                    ?against=&lt;runId&gt;
                  </code>{" "}
                  or run detail&apos;s <span className="font-semibold">vs parent</span> for an explicit
                  baseline. No LLM comparison.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] font-mono text-on-surface-variant">
                <span className="rounded border border-outline-variant/30 px-2 py-1 bg-surface-container-low">
                  current:{" "}
                  <Link href={`/runs/${current.id}`} className="text-primary">
                    {current.id.slice(0, 8)}…
                  </Link>
                </span>
                {baseline ? (
                  <span className="rounded border border-outline-variant/30 px-2 py-1 bg-surface-container-low">
                    baseline:{" "}
                    <Link href={`/runs/${baseline.id}`} className="text-primary">
                      {baseline.id.slice(0, 8)}…
                    </Link>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="px-4 lg:px-6 py-6 space-y-6 max-w-[1400px]">
            {targetMismatch ? (
              <div
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="alert"
              >
                These runs appear to be from different logical targets (identifier or hostname
                does not match)
                {current.target_name || baseline?.target_name
                  ? ` (${[current.target_name, baseline?.target_name].filter(Boolean).join(" vs ")})`
                  : ""}
                . You can still compare explicit run IDs, but interpret the drift carefully. Add{" "}
                <code className="font-mono text-xs bg-black/20 px-1 rounded">
                  ?against=&lt;runId&gt;
                </code>{" "}
                to choose a different baseline.
              </div>
            ) : null}

            {baselineMissing ? (
              <div
                className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant"
                role="status"
              >
                No older run exists for this target yet. Upload fresh evidence or reanalyze again later,
                or open{" "}
                <code className="font-mono text-xs text-on-surface">?against=&lt;runId&gt;</code>{" "}
                to compare against a specific baseline.
              </div>
            ) : null}

            {baseline ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {(
                    [
                      ["New", drift.summary.new, "new"],
                      ["Resolved", drift.summary.resolved, "resolved"],
                      ["Severity up", drift.summary.severity_up, "severity_up"],
                      ["Severity down", drift.summary.severity_down, "severity_down"],
                    ] as const
                  ).map(([label, n, tone]) => (
                    <div
                      key={label}
                      className={`rounded-lg border p-4 shadow-sm ${
                        tone === "new"
                          ? "border-red-200 bg-red-50/70"
                          : tone === "resolved"
                            ? "border-emerald-200 bg-emerald-50/70"
                            : tone === "severity_up"
                              ? "border-orange-200 bg-orange-50/70"
                              : "border-sky-200 bg-sky-50/70"
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                        {label}
                      </div>
                      <div
                        className={`mt-2 text-3xl font-bold tabular-nums ${
                          tone === "new"
                            ? "text-red-700"
                            : tone === "resolved"
                              ? "text-emerald-700"
                              : tone === "severity_up"
                                ? "text-orange-700"
                                : "text-sky-700"
                        }`}
                      >
                        {n}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/15 bg-surface-container-low/60">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Finding changes
                    </span>
                    <span className="text-[10px] text-on-surface-variant">
                      Unchanged: {drift.summary.unchanged}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-outline-variant/15 text-[10px] uppercase tracking-wider text-on-surface-variant">
                          <th className="px-3 py-2 font-semibold w-[120px]">Status</th>
                          <th className="px-3 py-2 font-semibold min-w-[200px]">Title</th>
                          <th className="px-3 py-2 font-semibold w-[140px]">Category</th>
                          <th className="px-3 py-2 font-semibold w-[90px]">Before</th>
                          <th className="px-3 py-2 font-semibold w-[90px]">After</th>
                          <th className="px-3 py-2 font-semibold min-w-[280px]">Evidence delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drift.rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-4 py-8 text-center text-on-surface-variant"
                            >
                              No finding changes between these two runs.
                            </td>
                          </tr>
                        ) : (
                          drift.rows.map((row) => (
                            <tr
                              key={row.match_key}
                              className="border-b border-outline-variant/10 align-top hover:bg-surface-container-low/40"
                            >
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPillClass(row.status)}`}
                                >
                                  {statusLabel(row.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-semibold text-on-surface">
                                {row.title}
                              </td>
                              <td className="px-3 py-2 text-on-surface-variant font-mono text-[11px]">
                                {row.category}
                              </td>
                              <td className="px-3 py-2 font-mono capitalize text-on-surface-variant">
                                {row.previous_severity ?? "—"}
                              </td>
                              <td className="px-3 py-2 font-mono capitalize text-on-surface-variant">
                                {row.current_severity ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="grid gap-1 text-[11px] leading-snug text-on-surface-variant">
                                  {row.status === "new" ? (
                                    <div>
                                      <span className="text-red-700 font-bold mr-1">
                                        +
                                      </span>
                                      {evidenceSnippet(row.evidence_current)}
                                    </div>
                                  ) : null}
                                  {row.status === "resolved" ? (
                                    <div>
                                      <span className="text-emerald-700 font-bold mr-1">−</span>
                                      {evidenceSnippet(row.evidence_previous)}
                                    </div>
                                  ) : null}
                                  {(row.status === "severity_up" ||
                                    row.status === "severity_down") && (
                                    <>
                                      <div>
                                        <span className="text-outline-variant mr-1">was:</span>
                                        {evidenceSnippet(row.evidence_previous)}
                                      </div>
                                      <div>
                                        <span className="text-outline-variant mr-1">now:</span>
                                        {evidenceSnippet(row.evidence_current)}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
