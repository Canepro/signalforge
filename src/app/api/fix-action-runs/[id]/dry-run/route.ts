import { NextRequest, NextResponse } from "next/server";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { getStorage } from "@/lib/storage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "invalid_json" }, { status: 400 });
  }
  const instanceId = typeof body.instance_id === "string" ? body.instance_id.trim() : "";
  const status = body.status === "failed" ? "failed" : body.status === "passed" ? "passed" : null;
  const summary = body.summary && typeof body.summary === "object" && !Array.isArray(body.summary) ?
    body.summary as Record<string, unknown>
  : null;
  if (!instanceId || !status || !summary) {
    return NextResponse.json({ error: "instance_id, status, and summary are required", code: "validation_error" }, { status: 400 });
  }

  const { id } = await params;
  const storage = await getStorage();
  const result = await storage.withTransaction((tx) =>
    tx.fixActionRuns.recordDryRun({
      actionRunId: id,
      sourceId: ctx.source.id,
      registrationId: ctx.registration.id,
      instanceId,
      status,
      summary,
    })
  );
  if (!result.ok) {
    if (result.code === "wrong_action") return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    if (result.code === "wrong_lease") return NextResponse.json({ error: "instance_id does not match action lease", code: "instance_mismatch" }, { status: 403 });
    if (result.code === "lease_expired") return NextResponse.json({ error: "Lease expired", code: "lease_expired" }, { status: 409 });
    return NextResponse.json({ error: "Dry-run cannot be recorded from this state", code: "invalid_transition" }, { status: 409 });
  }
  return NextResponse.json(result.row);
}
