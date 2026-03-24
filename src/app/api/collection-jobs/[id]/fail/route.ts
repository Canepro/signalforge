import { NextRequest, NextResponse } from "next/server";
import { saveDb } from "@/lib/db/client";
import {
  collectionJobToJson,
  failCollectionJobForAgent,
  getCollectionJobById,
} from "@/lib/db/source-job-repository";
import { resolveAgentRequest } from "@/lib/api/agent-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  const { id: jobId } = await params;
  const job = getCollectionJobById(ctx.db, jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
  }
  if (job.source_id !== ctx.source.id) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }
  if (job.lease_owner_id !== ctx.registration.id || !job.lease_owner_instance_id) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "invalid_json" },
      { status: 400 }
    );
  }

  const instanceId = typeof body.instance_id === "string" ? body.instance_id.trim() : "";
  if (!instanceId) {
    return NextResponse.json(
      { error: "instance_id is required in JSON body", code: "instance_id_required" },
      { status: 400 }
    );
  }
  if (job.lease_owner_instance_id !== instanceId) {
    return NextResponse.json(
      { error: "instance_id does not match job lease", code: "instance_mismatch" },
      { status: 403 }
    );
  }

  const code = typeof body.code === "string" ? body.code : "agent_failed";
  const message = typeof body.message === "string" ? body.message : "failed";

  const result = failCollectionJobForAgent(
    ctx.db,
    jobId,
    ctx.source.id,
    ctx.registration.id,
    instanceId,
    code,
    message
  );
  saveDb();

  if (!result.ok) {
    if (result.code === "wrong_job") {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }
    if (result.code === "wrong_lease") {
      return NextResponse.json(
        { error: "instance_id does not match job lease", code: "instance_mismatch" },
        { status: 403 }
      );
    }
    if (result.code === "lease_expired") {
      return NextResponse.json(
        { error: "Lease expired", code: "lease_expired" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Job cannot be failed from this state", code: "invalid_transition" },
      { status: 409 }
    );
  }

  return NextResponse.json(collectionJobToJson(result.row));
}
