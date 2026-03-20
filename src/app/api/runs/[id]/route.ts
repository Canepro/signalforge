import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRunWithArtifact, deriveSeverityCounts } from "@/lib/db/repository";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const row = getRunWithArtifact(db, id);

    if (!row) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: row.id,
      artifact_id: row.artifact_id,
      parent_run_id: row.parent_run_id,
      filename: row.filename,
      artifact_type: row.artifact_type,
      source_type: row.source_type,
      created_at: row.created_at,
      status: row.status,
      is_incomplete: Boolean(row.is_incomplete),
      incomplete_reason: row.incomplete_reason,
      analysis_error: row.analysis_error,
      model_used: row.model_used,
      tokens_used: row.tokens_used,
      duration_ms: row.duration_ms,
      severity_counts: deriveSeverityCounts(row.report_json),
      report: row.report_json ? JSON.parse(row.report_json) : null,
      environment: row.environment_json ? JSON.parse(row.environment_json) : null,
      noise: row.noise_json ? JSON.parse(row.noise_json) : null,
      pre_findings: row.pre_findings_json ? JSON.parse(row.pre_findings_json) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
