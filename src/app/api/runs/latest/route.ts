import { NextRequest, NextResponse } from "next/server";
import { requireRunsApiRequest } from "@/lib/api/admin-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";
import type { GetLatestRunBySourceTargetResponse } from "@/types/api-contract";

export async function GET(request: NextRequest) {
  try {
    const denied = await requireRunsApiRequest(request);
    if (denied) return denied;

    const targetIdentifier = request.nextUrl.searchParams.get("target_identifier")?.trim();
    if (!targetIdentifier) {
      return NextResponse.json(
        {
          error: "target_identifier is required",
          code: "target_identifier_required",
          example: "/api/runs/latest?target_identifier=mac:canepro-mac&artifact_type=mac-diagnostics",
        },
        { status: 400 }
      );
    }

    const sourceType = request.nextUrl.searchParams.get("source_type")?.trim() || null;
    const artifactType = request.nextUrl.searchParams.get("artifact_type")?.trim() || null;
    const storage = await getStorage();
    const run = await storage.runs.getLatestBySourceTarget({
      targetIdentifier,
      sourceType,
      artifactType,
    });

    if (!run) {
      return NextResponse.json(
        {
          error: "No run found for source target",
          code: "latest_run_not_found",
          latest_by_source_target: {
            target_identifier: targetIdentifier,
            source_type: sourceType,
            artifact_type: artifactType,
          },
        },
        { status: 404 }
      );
    }

    const body: GetLatestRunBySourceTargetResponse = {
      latest_by_source_target: {
        target_identifier: targetIdentifier,
        source_type: sourceType,
        artifact_type: artifactType,
      },
      run,
      links: {
        run_ui: `/runs/${run.id}`,
        report_api: `/api/runs/${run.id}/report`,
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/runs/latest");
  }
}
