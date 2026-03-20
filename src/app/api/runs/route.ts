import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import { insertArtifact, insertRun, listRuns } from "@/lib/db/repository";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { detectArtifactType } from "@/lib/adapter/registry";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let content: string;
    let filename: string;
    let artifactType: string | undefined;
    let sourceType = "api";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      content = await file.text();
      filename = file.name;
      artifactType = (formData.get("artifact_type") as string) ?? undefined;
      sourceType = (formData.get("source_type") as string) ?? "upload";
    } else {
      const body = await request.json();
      content = body.content;
      filename = body.filename ?? "untitled.log";
      artifactType = body.artifact_type;
      sourceType = body.source_type ?? "api";
      if (!content) {
        return NextResponse.json({ error: "content is required" }, { status: 400 });
      }
    }

    const resolvedType = artifactType ?? detectArtifactType(content);
    const db = await getDb();

    const artifact = insertArtifact(db, {
      artifact_type: resolvedType,
      source_type: sourceType,
      filename,
      content,
    });

    const result = await analyzeArtifact(content, { artifactType: resolvedType });
    const run = insertRun(db, artifact.id, result);
    saveDb();

    return NextResponse.json({
      run_id: run.id,
      artifact_id: artifact.id,
      status: run.status,
      report: result.report,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    const runs = listRuns(db);
    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
