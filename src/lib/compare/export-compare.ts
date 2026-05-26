/**
 * Helpers for exporting compare drift JSON from the compare UI and CLI.
 */

export function buildCompareExportFilename(
  currentFilename: string,
  baselineFilename?: string | null
): string {
  const slug = (name: string) =>
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "run";

  const currentSlug = slug(currentFilename);
  if (baselineFilename?.trim()) {
    return `${slug(baselineFilename)}-vs-${currentSlug}-compare.json`;
  }
  return `${currentSlug}-compare.json`;
}

export function buildCompareApiPath(currentRunId: string, againstRunId?: string | null): string {
  const base = `/api/runs/${currentRunId}/compare`;
  if (!againstRunId?.trim()) return base;
  return `${base}?against=${encodeURIComponent(againstRunId)}`;
}
