import { NextRequest, NextResponse } from "next/server";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { emitRunLifecycleEvents } from "@/lib/domain-events";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: parentRunId } = await params;
    const storage = await getStorage();
    const reanalyze = await storage.runs.getReanalyzeSource(parentRunId);
    if (!reanalyze.ok) {
      if (reanalyze.error === "run_not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const result = await analyzeArtifact(reanalyze.content, {
      artifactType: reanalyze.artifact_type,
    });

    const newRun = await storage.withTransaction((tx) =>
      tx.runs.persistAnalyzedRun({
        artifactType: reanalyze.artifact_type,
        sourceType: reanalyze.submission.source_type,
        filename: reanalyze.submission.filename,
        content: reanalyze.content,
        ingestion: {
          target_identifier: reanalyze.submission.target_identifier ?? null,
          source_label: reanalyze.submission.source_label ?? null,
          collector_type: reanalyze.submission.collector_type ?? null,
          collector_version: reanalyze.submission.collector_version ?? null,
          collected_at: reanalyze.submission.collected_at ?? null,
        },
        analysis: result,
        parentRunId,
      })
    );
    emitRunLifecycleEvents({
      run_id: newRun.run_id,
      artifact_id: newRun.artifact_id,
      status: newRun.status,
      analysis_error: result.analysis_error ?? null,
      parent_run_id: parentRunId,
    });

    return NextResponse.json({
      run_id: newRun.run_id,
      artifact_id: newRun.artifact_id,
      parent_run_id: parentRunId,
      status: newRun.status,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/runs/[id]/reanalyze");
  }
}
