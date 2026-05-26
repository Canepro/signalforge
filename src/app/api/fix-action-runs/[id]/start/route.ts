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
  if (!instanceId) {
    return NextResponse.json({ error: "instance_id is required", code: "instance_id_required" }, { status: 400 });
  }

  const { id } = await params;
  const storage = await getStorage();
  const result = await storage.withTransaction((tx) =>
    tx.fixActionRuns.startForAgent(id, ctx.source.id, ctx.registration.id, instanceId)
  );
  if (!result.ok) {
    if (result.code === "wrong_action") return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    if (result.code === "wrong_lease") return NextResponse.json({ error: "instance_id does not match action lease", code: "instance_mismatch" }, { status: 403 });
    if (result.code === "lease_expired") return NextResponse.json({ error: "Lease expired", code: "lease_expired" }, { status: 409 });
    return NextResponse.json({ error: "Fix action cannot be started", code: "invalid_transition" }, { status: 409 });
  }
  return NextResponse.json(result.row);
}
