import { NextRequest, NextResponse } from "next/server";
import { resolveAutomationAgentRequest } from "@/lib/api/automation-agent-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const ctx = await resolveAutomationAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  if (url.searchParams.has("source_id")) {
    return NextResponse.json(
      { error: "source_id query parameter is not allowed", code: "invalid_query" },
      { status: 400 }
    );
  }

  const rawLimit = url.searchParams.get("limit");
  let limit = 10;
  if (rawLimit !== null) {
    const n = parseInt(rawLimit, 10);
    if (Number.isNaN(n) || n < 1) {
      return NextResponse.json(
        { error: "limit must be a positive integer", code: "invalid_limit" },
        { status: 400 }
      );
    }
    limit = Math.min(50, n);
  }

  try {
    const storage = await getStorage();
    const signals = await storage.withTransaction((tx) =>
      tx.automationSignals.listNextForSource(ctx.source.id, limit)
    );
    return NextResponse.json({
      signals: signals.map((signal) => ({
        id: signal.id,
        source_id: signal.source_id,
        run_id: signal.run_id,
        artifact_type: signal.artifact_type,
        finding_id: signal.finding_id,
        finding_title: signal.finding_title,
        severity: signal.severity,
        category: signal.category,
        signal_type: signal.signal_type,
        status: signal.status,
        created_at: signal.created_at,
        last_seen_at: signal.last_seen_at,
      })),
    });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/automation-agent/signals/next");
  }
}
