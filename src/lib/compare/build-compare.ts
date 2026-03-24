import type { Database } from "sql.js";
import type { Finding } from "@/lib/analyzer/schema";
import {
  findPreviousRunForSameTarget,
  getRun,
  getRunWithArtifact,
  parseEnvironmentHostname,
  type RunRow,
} from "@/lib/db/repository";
import { compareTargetsMismatch, preferredTargetDisplayLabel } from "@/lib/target-identity";
import { compareFindingsDrift, type FindingsDriftResult } from "./findings-diff";

export type BaselineSelection = "implicit_same_target" | "explicit" | "none";

/** Programmatic compare snapshot (ISO timestamps; no UI formatting). */
export interface CompareRunSnapshot {
  /** Run UUID (duplicate of `run_id` for backward compatibility). */
  id: string;
  /** Same value as `id`; matches `run_id` on POST responses for tooling consistency. */
  run_id: string;
  filename: string;
  created_at: string;
  target_identifier: string | null;
  environment_hostname: string | null;
  target_display_label: string | null;
}

export interface CompareDriftPayload {
  current: CompareRunSnapshot;
  baseline: CompareRunSnapshot | null;
  baseline_missing: boolean;
  target_mismatch: boolean;
  baseline_selection: BaselineSelection;
  /** Echo of `against` query param when provided. */
  against_requested: string | null;
  drift: FindingsDriftResult;
}

export type CompareDriftError =
  | "current_not_found"
  | "baseline_not_found"
  | "against_equals_current";

function parseFindings(reportJson: string | null): Finding[] {
  if (!reportJson) return [];
  try {
    const report = JSON.parse(reportJson) as { findings?: Finding[] };
    return Array.isArray(report.findings) ? report.findings : [];
  } catch {
    return [];
  }
}

function emptyDrift(): FindingsDriftResult {
  return {
    summary: {
      new: 0,
      resolved: 0,
      severity_up: 0,
      severity_down: 0,
      unchanged: 0,
    },
    rows: [],
  };
}

function snapshotFromRun(row: RunRow): CompareRunSnapshot {
  const host = parseEnvironmentHostname(row.environment_json ?? null);
  return {
    id: row.id,
    run_id: row.id,
    filename: row.filename,
    created_at: row.created_at,
    target_identifier: row.target_identifier ?? null,
    environment_hostname: host,
    target_display_label: preferredTargetDisplayLabel({
      target_identifier: row.target_identifier ?? null,
      environment_hostname: host,
    }),
  };
}

/**
 * Deterministic compare/drift payload (same semantics as `/runs/[id]/compare` UI).
 * No LLM — uses {@link compareFindingsDrift} only.
 */
export function buildCompareDriftPayload(
  db: Database,
  currentRunId: string,
  against?: string | null
): { ok: true; payload: CompareDriftPayload } | { ok: false; error: CompareDriftError } {
  if (against && against === currentRunId) {
    return { ok: false, error: "against_equals_current" };
  }

  const currentRow = getRunWithArtifact(db, currentRunId);
  if (!currentRow) {
    return { ok: false, error: "current_not_found" };
  }

  const current = snapshotFromRun(currentRow);

  let baselineRow = against
    ? getRun(db, against)
    : findPreviousRunForSameTarget(db, currentRunId);

  if (against && !baselineRow) {
    return { ok: false, error: "baseline_not_found" };
  }

  const baselineMissing = baselineRow === null;
  const baseline = baselineRow ? snapshotFromRun(baselineRow) : null;

  const targetMismatch = Boolean(
    baselineRow &&
      compareTargetsMismatch(
        {
          target_identifier: currentRow.target_identifier ?? null,
          environment_hostname: parseEnvironmentHostname(
            currentRow.environment_json ?? null
          ),
        },
        {
          target_identifier: baselineRow.target_identifier ?? null,
          environment_hostname: parseEnvironmentHostname(
            baselineRow.environment_json ?? null
          ),
        }
      )
  );

  const drift = baselineRow
    ? compareFindingsDrift(
        parseFindings(baselineRow.report_json),
        parseFindings(currentRow.report_json)
      )
    : emptyDrift();

  const baselineSelection: BaselineSelection = baselineMissing
    ? "none"
    : against
      ? "explicit"
      : "implicit_same_target";

  return {
    ok: true,
    payload: {
      current,
      baseline,
      baseline_missing: baselineMissing,
      target_mismatch: targetMismatch,
      baseline_selection: baselineSelection,
      against_requested: against ?? null,
      drift,
    },
  };
}
