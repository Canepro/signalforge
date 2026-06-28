import { NextRequest, NextResponse } from "next/server";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { getStorage } from "@/lib/storage";
import { validateAgentJobClaimGate } from "@/lib/storage/shared/agent-lifecycle-shared";

function parseCapabilities(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

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
  const result = await storage.withTransaction(async (tx) => {
    const job = await tx.jobs.getById(jobId);
    if (!job) {
      return { ok: false as const, code: "not_found" as const };
    }
    if (job.source_id !== ctx.source.id) {
      return { ok: false as const, code: "wrong_source" as const };
    }
    if (job.status !== "queued") {
      return { ok: false as const, code: "not_queued" as const };
    }

    const gate = validateAgentJobClaimGate({
      sourceEnabled: ctx.source.enabled,
      lastHeartbeatAt: ctx.registration.last_heartbeat_at,
      agentCapabilities: parseCapabilities(ctx.registration.last_capabilities_json),
      sourceCapabilities: ctx.source.capabilities,
      jobArtifactType: job.artifact_type,
    });
    if (!gate.ok) {
      return { ok: false as const, code: gate.gate };
    }

    return tx.jobs.claimForAgent(
      jobId,
      ctx.source.id,
      ctx.registration.id,
      instance_id,
      lease_ttl_seconds
    );
  });

  if (result.ok === false) {
    if (result.code === "not_found") {
      return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
    }
    if (result.code === "wrong_source") {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }
    if (
      result.code === "source_disabled" ||
      result.code === "heartbeat_required" ||
      result.code === "capabilities_empty" ||
      result.code === "capability_mismatch"
    ) {
      return NextResponse.json(
        { error: "Job is not eligible for this agent", code: result.code },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Job is not available to claim", code: "job_already_claimed" },
      { status: 409 }
    );
  }

  return NextResponse.json(result.row);
}
