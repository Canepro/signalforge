import { NextRequest, NextResponse } from "next/server";
import { saveDb } from "@/lib/db/client";
import { listNextQueuedJobSummariesForSource } from "@/lib/db/source-job-repository";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

export async function GET(request: NextRequest) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  if (url.searchParams.has("source_id")) {
    return NextResponse.json(
      { error: "source_id query parameter is not allowed", code: "invalid_query" },
      { status: 400 }
    );
  }

  const rawLimit = url.searchParams.get("limit");
  let limit = 1;
  if (rawLimit !== null) {
    const n = parseInt(rawLimit, 10);
    if (Number.isNaN(n) || n < 1) {
      return NextResponse.json(
        { error: "limit must be a positive integer", code: "invalid_limit" },
        { status: 400 }
      );
    }
    limit = Math.min(10, n);
  }

  try {
    const { jobs, gate } = listNextQueuedJobSummariesForSource(
      ctx.db,
      ctx.source,
      ctx.registration,
      limit
    );
    saveDb();
    return NextResponse.json({ jobs, gate });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/agent/jobs/next");
  }
}
