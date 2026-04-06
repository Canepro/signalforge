import { NextRequest, NextResponse } from "next/server";
import type { ApplyAgentHeartbeatResult } from "@/lib/db/source-job-repository";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

function heartbeatResponseBody(result: ApplyAgentHeartbeatResult) {
  const lease = result.active_job_lease;
  if (!lease.requested) {
    return { ok: true, active_job_lease: null };
  }
  if (lease.extended) {
    return {
      ok: true,
      active_job_lease: {
        job_id: lease.job_id,
        extended: true,
        lease_expires_at: lease.lease_expires_at,
      },
    };
  }
  return {
    ok: true,
    active_job_lease: {
      job_id: lease.job_id,
      extended: false,
      code: lease.code,
    },
  };
}

export async function POST(request: NextRequest) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "invalid_json" },
      { status: 400 }
    );
  }

  const capabilities = Array.isArray(body.capabilities) ?
    body.capabilities.filter((x): x is string => typeof x === "string")
  : [];
  const attributes =
    body.attributes && typeof body.attributes === "object" && body.attributes !== null ?
      (body.attributes as Record<string, unknown>)
    : {};
  const agent_version = typeof body.agent_version === "string" ? body.agent_version : "";

  let active_job_id: string | null = null;
  if (body.active_job_id !== undefined && body.active_job_id !== null) {
    if (typeof body.active_job_id !== "string" || !body.active_job_id.trim()) {
      return NextResponse.json(
        { error: "active_job_id must be a non-empty string when set", code: "invalid_active_job_id" },
        { status: 400 }
      );
    }
    active_job_id = body.active_job_id.trim();
  }

  let instance_id: string | null = null;
  if (typeof body.instance_id === "string" && body.instance_id.trim()) {
    instance_id = body.instance_id.trim();
  }

  if (active_job_id && !instance_id) {
    return NextResponse.json(
      {
        error: "instance_id is required when active_job_id is set",
        code: "instance_id_required",
      },
      { status: 400 }
    );
  }

  try {
    const storage = await getStorage();
    const heartbeat = await storage.withTransaction((tx) =>
      tx.agents.applyHeartbeatAfterLeaseReap({
        sourceId: ctx.source.id,
        registrationId: ctx.registration.id,
        capabilities,
        attributes,
        agentVersion: agent_version,
        activeJobId: active_job_id,
        instanceId: instance_id,
      })
    );
    if (!heartbeat.ok) {
      if (heartbeat.code === "active_job_not_found") {
        return NextResponse.json(
          { error: "active_job_id does not refer to a job", code: "active_job_not_found" },
          { status: 409 }
        );
      }
      if (heartbeat.code === "forbidden") {
        return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
      }
      if (heartbeat.code === "invalid_active_job_state") {
        return NextResponse.json(
          {
            error: "Job is not in claimed or running state",
            code: "invalid_active_job_state",
          },
          { status: 409 }
        );
      }
      if (heartbeat.code === "invalid_state") {
        return NextResponse.json(
          { error: "Job has no lease instance", code: "invalid_state" },
          { status: 409 }
        );
      }
      if (heartbeat.code === "instance_mismatch") {
        return NextResponse.json(
          { error: "instance_id does not match job lease", code: "instance_mismatch" },
          { status: 403 }
        );
      }
      if (heartbeat.code === "lease_expired") {
        return NextResponse.json({ error: "Lease expired", code: "lease_expired" }, { status: 409 });
      }
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }

    return NextResponse.json(heartbeatResponseBody(heartbeat.result));
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/agent/heartbeat");
  }
}
