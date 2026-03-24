import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRunWithArtifact } from "@/lib/db/repository";
import { toRunDetailJson } from "@/lib/api/run-detail-json";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

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

    return NextResponse.json(toRunDetailJson(row));
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs/[id]");
  }
}
