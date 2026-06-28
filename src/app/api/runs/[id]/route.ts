import { NextRequest, NextResponse } from "next/server";
import { requireRunsApiRequest } from "@/lib/api/admin-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await requireRunsApiRequest(request);
    if (denied) return denied;

    const { id } = await params;
    const storage = await getStorage();
    const row = await storage.runs.getApiDetail(id);

    if (!row) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs/[id]");
  }
}
