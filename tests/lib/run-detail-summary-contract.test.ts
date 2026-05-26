import { describe, expect, it } from "vitest";
import {
  CALLOUT_SUMMARY_MODULE_KINDS,
  CHARTABLE_SUMMARY_MODULE_KINDS,
  isCalloutSummaryModule,
  isChartableSummaryModule,
} from "@/lib/run-detail-summary-contract";
import type { RunDetailSummaryModule } from "@/types/api";

describe("run-detail-summary-contract", () => {
  it("separates chartable kinds from callout kinds", () => {
    expect(CHARTABLE_SUMMARY_MODULE_KINDS).toEqual(["stat-grid", "bar-list"]);
    expect(CALLOUT_SUMMARY_MODULE_KINDS).toEqual(["callout-list"]);
    expect(
      CHARTABLE_SUMMARY_MODULE_KINDS.some((kind) =>
        (CALLOUT_SUMMARY_MODULE_KINDS as readonly string[]).includes(kind)
      )
    ).toBe(false);
  });

  it("classifies modules by presentation kind", () => {
    const statGrid: RunDetailSummaryModule = {
      id: "stats",
      title: "Stats",
      summary: "summary",
      tone: "neutral",
      prominence: "supporting",
      kind: "stat-grid",
      stats: [{ label: "A", value: "1" }],
    };
    const callouts: RunDetailSummaryModule = {
      id: "callouts",
      title: "Callouts",
      summary: "summary",
      tone: "warning",
      prominence: "supporting",
      kind: "callout-list",
      callouts: [{ title: "T", body: "B", tone: "warning" }],
    };

    expect(isChartableSummaryModule(statGrid)).toBe(true);
    expect(isCalloutSummaryModule(statGrid)).toBe(false);
    expect(isChartableSummaryModule(callouts)).toBe(false);
    expect(isCalloutSummaryModule(callouts)).toBe(true);
  });
});
