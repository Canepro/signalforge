import { NextRequest, NextResponse } from "next/server";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

/**
 * JSON drift/compare for programmatic use (same deterministic logic as the UI compare page).
 * Query: `?against=<runId>` to compare against a specific baseline; otherwise uses
 * target-aware implicit baseline ({@link findPreviousRunForSameTarget}).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const against = request.nextUrl.searchParams.get("against");
    const storage = await getStorage();
    const result = await storage.runs.getComparePayload(id, against);

    if (!result.ok) {
      if (result.error === "against_equals_current") {
        return NextResponse.json(
          { error: "against cannot be the same as current run id" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(result.payload);
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs/[id]/compare");
  }
}
