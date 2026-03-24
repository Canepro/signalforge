/**
 * UI/API hrefs for compare/drift. Baseline selection is server-side; these only build paths.
 */

/** Implicit baseline: `findPreviousRunForSameTarget` (latest older same logical target). */
export function compareRunHref(runId: string): string {
  return `/runs/${runId}/compare`;
}

/** Explicit baseline (e.g. reanalyze parent or any run id). */
export function compareRunAgainstHref(runId: string, baselineRunId: string): string {
  const q = new URLSearchParams({ against: baselineRunId });
  return `/runs/${runId}/compare?${q.toString()}`;
}
