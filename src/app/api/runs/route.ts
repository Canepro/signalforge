import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import { insertArtifact, insertRun, listRuns } from "@/lib/db/repository";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { detectArtifactType } from "@/lib/adapter/registry";
import {
  parseIngestionMeta,
  ingestionRecordFromFormData,
} from "@/lib/ingestion/meta";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

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
    const db = await getDb();

    const artifact = insertArtifact(db, {
      artifact_type: resolvedType,
      source_type: sourceType,
      filename,
      content,
    });

    const result = await analyzeArtifact(content, { artifactType: resolvedType });
    const run = insertRun(db, artifact.id, result, {
      filename,
      source_type: sourceType,
      target_identifier: ingestion.target_identifier,
      source_label: ingestion.source_label,
      collector_type: ingestion.collector_type,
      collector_version: ingestion.collector_version,
      collected_at: ingestion.collected_at,
    });
    saveDb();

    return NextResponse.json({
      run_id: run.id,
      artifact_id: artifact.id,
      status: run.status,
      report: result.report,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/runs");
  }
}

export async function GET() {
  try {
    const db = await getDb();
    const runs = listRuns(db);
    return NextResponse.json({ runs });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs");
  }
}
