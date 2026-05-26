import { NextRequest, NextResponse } from "next/server";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { getStorage } from "@/lib/storage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "invalid_json" }, { status: 400 });
  }
  const instanceId = typeof body.instance_id === "string" ? body.instance_id.trim() : "";
  if (!instanceId) {
    return NextResponse.json({ error: "instance_id is required", code: "instance_id_required" }, { status: 400 });
  }
  const ttlRaw = body.lease_ttl_seconds;
  const ttl = typeof ttlRaw === "number" && Number.isFinite(ttlRaw) ? ttlRaw : 300;

  const { id } = await params;
  const storage = await getStorage();
  const result = await storage.withTransaction((tx) =>
    tx.fixActionRuns.claimForAgent(id, ctx.source.id, ctx.registration.id, instanceId, ttl)
  );
  if (!result.ok) {
    if (result.code === "not_found") return NextResponse.json({ error: "Fix action not found", code: "not_found" }, { status: 404 });
    if (result.code === "wrong_source") return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Fix action is not available to claim", code: "not_queued" }, { status: 409 });
  }
  return NextResponse.json(result.row);
}
