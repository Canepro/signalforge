import { NextRequest, NextResponse } from "next/server";
import { resolveAutomationAgentRequest } from "@/lib/api/automation-agent-auth";
import { buildFixActionRunResponse } from "@/lib/api/fix-action-response";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAutomationAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  try {
    const { id } = await params;
    const storage = await getStorage();
    const action = await storage.withTransaction((tx) => tx.fixActionRuns.getById(id));
    if (!action) {
      return NextResponse.json({ error: "Fix action run not found", code: "not_found" }, { status: 404 });
    }
    if (action.source_id !== ctx.source.id) {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(buildFixActionRunResponse(action));
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/automation-agent/fix-action-runs/[id]");
  }
}
