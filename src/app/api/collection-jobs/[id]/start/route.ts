import { NextRequest, NextResponse } from "next/server";
import { saveDb } from "@/lib/db/client";
import {
  collectionJobToJson,
  getCollectionJobById,
  startCollectionJobForAgent,
} from "@/lib/db/source-job-repository";
import { resolveAgentRequest } from "@/lib/api/agent-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as Record<string, unknown>;
    }
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

  const { id: jobId } = await params;
  const job = getCollectionJobById(ctx.db, jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
  }
  if (job.source_id !== ctx.source.id) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }
  if (job.status !== "claimed") {
    return NextResponse.json(
      {
        error: "Job cannot be started in its current state (claim first; lease may have expired and requeued the job).",
        code: "invalid_transition",
      },
      { status: 409 }
    );
  }
  if (job.lease_owner_id !== ctx.registration.id) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }
  if (!job.lease_owner_instance_id) {
    return NextResponse.json({ error: "Invalid job lease state", code: "invalid_state" }, { status: 409 });
  }
  if (job.lease_owner_instance_id !== instanceId) {
    return NextResponse.json(
      { error: "instance_id does not match job lease", code: "instance_mismatch" },
      { status: 403 }
    );
  }

  const result = startCollectionJobForAgent(
    ctx.db,
    jobId,
    ctx.source.id,
    ctx.registration.id,
    instanceId
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
      { error: "Job cannot be started", code: "invalid_transition" },
      { status: 409 }
    );
  }

  return NextResponse.json(collectionJobToJson(result.row));
}
