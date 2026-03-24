import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import { getArtifactById, getRun, insertRun, submissionMetaFromRun } from "@/lib/db/repository";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: parentRunId } = await params;
    const db = await getDb();
    const run = getRun(db, parentRunId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const artifact = getArtifactById(db, run.artifact_id);
    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const result = await analyzeArtifact(artifact.content, {
      artifactType: artifact.artifact_type,
    });

    const newRun = insertRun(
      db,
      artifact.id,
      result,
      submissionMetaFromRun(run),
      parentRunId
    );
    saveDb();

    return NextResponse.json({
      run_id: newRun.id,
      artifact_id: artifact.id,
      parent_run_id: parentRunId,
      status: newRun.status,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/runs/[id]/reanalyze");
  }
}
