import { NextRequest, NextResponse } from "next/server";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { getStorage } from "@/lib/storage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  const { id: jobId } = await params;
  let body: Record<string, unknown> = {};
  try {
    const t = await request.text();
    if (t.trim()) body = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const instance_id = typeof body.instance_id === "string" ? body.instance_id.trim() : "";
  if (!instance_id || instance_id.length > 256) {
    return NextResponse.json(
      { error: "instance_id is required (max 256 chars)", code: "validation_error" },
      { status: 400 }
    );
  }

  const ttlRaw = body.lease_ttl_seconds;
  const lease_ttl_seconds =
    typeof ttlRaw === "number" && Number.isFinite(ttlRaw) ? ttlRaw : 300;

  const storage = await getStorage();
  const result = await storage.withTransaction((tx) =>
    tx.jobs.claimForAgent(
      jobId,
      ctx.source.id,
      ctx.registration.id,
      instance_id,
      lease_ttl_seconds
    )
  );

  if (result.ok === false) {
    if (result.code === "not_found") {
      return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
    }
    if (result.code === "wrong_source") {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Job is not available to claim", code: "job_already_claimed" },
      { status: 409 }
    );
  }

  return NextResponse.json(result.row);
}
