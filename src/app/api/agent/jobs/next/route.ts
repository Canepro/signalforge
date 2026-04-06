import { NextRequest, NextResponse } from "next/server";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

const MAX_WAIT_SECONDS = 20;
const WAIT_POLL_INTERVAL_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const rawWaitSeconds = url.searchParams.get("wait_seconds");
  let waitSeconds = 0;
  if (rawWaitSeconds !== null) {
    const n = parseInt(rawWaitSeconds, 10);
    if (Number.isNaN(n) || n < 0) {
      return NextResponse.json(
        { error: "wait_seconds must be a non-negative integer", code: "invalid_wait_seconds" },
        { status: 400 }
      );
    }
    waitSeconds = Math.min(MAX_WAIT_SECONDS, n);
  }

  try {
    const storage = await getStorage();
    const deadline = Date.now() + waitSeconds * 1000;

    const loadNext = () =>
      storage.withTransaction((tx) =>
        tx.jobs.listNextForAgentAfterLeaseReap(ctx.source.id, ctx.registration.id, limit)
      );

    let result = await loadNext();

    while (waitSeconds > 0 && result.jobs.length === 0 && result.gate === null && Date.now() < deadline) {
      if (request.signal.aborted) break;
      await sleep(Math.min(WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
      result = await loadNext();
    }

    const { jobs, gate } = result;
    return NextResponse.json({ jobs, gate });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/agent/jobs/next");
  }
}
