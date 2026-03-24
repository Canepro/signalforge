import { NextRequest, NextResponse } from "next/server";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { detectArtifactType } from "@/lib/adapter/registry";
import {
  parseIngestionMeta,
  ingestionRecordFromFormData,
} from "@/lib/ingestion/meta";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let content: string;
    let filename: string;
    let artifactType: string | undefined;
    let sourceType = "api";
    let ingestionInput: Record<string, unknown> = {};

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
      ingestionInput = ingestionRecordFromFormData(formData);
    } else {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      content = typeof body.content === "string" ? body.content : "";
      filename = typeof body.filename === "string" ? body.filename : "untitled.log";
      artifactType = typeof body.artifact_type === "string" ? body.artifact_type : undefined;
      sourceType = typeof body.source_type === "string" ? body.source_type : "api";
      if (!content) {
        return NextResponse.json({ error: "content is required" }, { status: 400 });
      }
      ingestionInput = body;
    }

    const parsedMeta = parseIngestionMeta(ingestionInput);
    if (!parsedMeta.ok) {
      return NextResponse.json({ error: parsedMeta.error }, { status: 400 });
    }
    const ingestion = parsedMeta.meta;

    const resolvedType = artifactType ?? detectArtifactType(content);
    const result = await analyzeArtifact(content, { artifactType: resolvedType });
    const storage = await getStorage();
    const persisted = await storage.withTransaction((tx) =>
      tx.runs.persistAnalyzedRun({
        artifactType: resolvedType,
        sourceType,
        filename,
        content,
        ingestion,
        analysis: result,
      })
    );

    return NextResponse.json({
      run_id: persisted.run_id,
      artifact_id: persisted.artifact_id,
      status: persisted.status,
      report: result.report,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/runs");
  }
}

export async function GET() {
  try {
    const storage = await getStorage();
    const runs = await storage.runs.listSummaries();
    return NextResponse.json({ runs });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs");
  }
}
