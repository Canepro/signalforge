import type { RunDetailSummaryModule } from "@/types/api";

/**
 * Module kinds that render quantitative or comparative evidence (stats, bars).
 * Prefer these when evidence is naturally numeric and comparison saves reading load.
 */
export const CHARTABLE_SUMMARY_MODULE_KINDS = ["stat-grid", "bar-list"] as const;

/**
 * Module kinds for categorical or explanatory evidence that should stay textual.
 */
export const CALLOUT_SUMMARY_MODULE_KINDS = ["callout-list"] as const;

export type ChartableSummaryModuleKind = (typeof CHARTABLE_SUMMARY_MODULE_KINDS)[number];
export type CalloutSummaryModuleKind = (typeof CALLOUT_SUMMARY_MODULE_KINDS)[number];
export type RunDetailSummaryModuleKind =
  | ChartableSummaryModuleKind
  | CalloutSummaryModuleKind;

export function isChartableSummaryModule(
  module: RunDetailSummaryModule
): module is Extract<RunDetailSummaryModule, { kind: ChartableSummaryModuleKind }> {
  return (CHARTABLE_SUMMARY_MODULE_KINDS as readonly string[]).includes(module.kind);
}

export function isCalloutSummaryModule(
  module: RunDetailSummaryModule
): module is Extract<RunDetailSummaryModule, { kind: CalloutSummaryModuleKind }> {
  return (CALLOUT_SUMMARY_MODULE_KINDS as readonly string[]).includes(module.kind);
}
