import { NextRequest, NextResponse } from "next/server";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const storage = await getStorage();
    const report = await storage.runs.getReport(id);
    if (report === null) {
      return NextResponse.json({ error: "No report available" }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs/[id]/report");
  }
}
