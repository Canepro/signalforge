import { NextRequest, NextResponse } from "next/server";
import { saveDb } from "@/lib/db/client";
import { insertArtifact, insertRun } from "@/lib/db/repository";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { detectArtifactType } from "@/lib/adapter/registry";
import { parseIngestionMeta, ingestionRecordFromFormData } from "@/lib/ingestion/meta";
import {
  getCollectionJobById,
  markCollectionJobSubmittedForAgent,
} from "@/lib/db/source-job-repository";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { emitDomainEvent } from "@/lib/domain-events";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

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

  if (job.status === "submitted" && job.result_run_id && job.result_artifact_id) {
    return NextResponse.json(
      {
        error: "Job already submitted",
        code: "job_already_submitted",
        run_id: job.result_run_id,
        artifact_id: job.result_artifact_id,
      },
      { status: 409 }
    );
  }

  if (
    job.status !== "running" ||
    job.lease_owner_id !== ctx.registration.id ||
    !job.lease_owner_instance_id
  ) {
    return NextResponse.json(
      { error: "Job is not running under this agent lease", code: "invalid_state" },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return NextResponse.json({ error: "Lease expired", code: "lease_expired" }, { status: 409 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "multipart/form-data with file is required", code: "invalid_content_type" },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const headerInstance = request.headers.get("x-signalforge-agent-instance-id")?.trim() ?? "";
  const formInstanceRaw = formData.get("instance_id");
  const formInstance =
    typeof formInstanceRaw === "string" ? formInstanceRaw.trim() : "";
  const instanceId = headerInstance || formInstance;
  if (!instanceId) {
    return NextResponse.json(
      {
        error:
          "instance_id is required (form field instance_id or header X-SignalForge-Agent-Instance-Id)",
        code: "instance_id_required",
      },
      { status: 400 }
    );
  }
  if (instanceId !== job.lease_owner_instance_id) {
    return NextResponse.json(
      { error: "instance_id does not match job lease", code: "instance_mismatch" },
      { status: 403 }
    );
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided", code: "file_required" }, { status: 400 });
  }

  const content = await file.text();
  const filename = file.name;
  const artifactType =
    (formData.get("artifact_type") as string) || job.artifact_type || undefined;
  const sourceType = "agent";

  const baseMeta = ingestionRecordFromFormData(formData);
  const ingestionInput: Record<string, unknown> = {
    ...baseMeta,
    target_identifier: ctx.source.target_identifier,
    source_label: `agent:${ctx.registration.id}`,
  };
  if (ingestionInput.collector_type == null || ingestionInput.collector_type === "") {
    ingestionInput.collector_type = ctx.source.default_collector_type;
  }
  if (ingestionInput.collector_version == null || ingestionInput.collector_version === "") {
    ingestionInput.collector_version = ctx.source.default_collector_version ?? undefined;
  }

  const parsedMeta = parseIngestionMeta(ingestionInput);
  if (!parsedMeta.ok) {
    return NextResponse.json({ error: parsedMeta.error }, { status: 400 });
  }
  const ingestion = parsedMeta.meta;

  const resolvedType = artifactType ?? detectArtifactType(content);

  try {
    const artifact = insertArtifact(ctx.db, {
      artifact_type: resolvedType,
      source_type: sourceType,
      filename,
      content,
    });

    const result = await analyzeArtifact(content, { artifactType: resolvedType });
    const run = insertRun(ctx.db, artifact.id, result, {
      filename,
      source_type: sourceType,
      target_identifier: ingestion.target_identifier,
      source_label: ingestion.source_label,
      collector_type: ingestion.collector_type,
      collector_version: ingestion.collector_version,
      collected_at: ingestion.collected_at,
    });

    const submitted = markCollectionJobSubmittedForAgent(
      ctx.db,
      jobId,
      ctx.source.id,
      ctx.registration.id,
      instanceId,
      artifact.id,
      run.id,
      run.status
    );

    if (!submitted) {
      return NextResponse.json(
        { error: "Job state changed during upload; retry with a new job if needed", code: "conflict" },
        { status: 409 }
      );
    }

    const occurred = new Date().toISOString();
    emitDomainEvent("run.created", {
      run_id: run.id,
      artifact_id: artifact.id,
      source_id: ctx.source.id,
      job_id: jobId,
      occurred_at: occurred,
    });
    if (run.status === "complete") {
      emitDomainEvent("run.completed", { run_id: run.id, job_id: jobId, occurred_at: occurred });
    } else {
      emitDomainEvent("run.failed", {
        run_id: run.id,
        job_id: jobId,
        error: run.analysis_error ?? run.status,
        occurred_at: occurred,
      });
    }

    saveDb();

    return NextResponse.json({
      job: {
        id: submitted.id,
        status: submitted.status,
        result_run_id: submitted.result_run_id,
        result_artifact_id: submitted.result_artifact_id,
        result_analysis_status: submitted.result_analysis_status ?? run.status,
      },
      run_id: run.id,
      artifact_id: artifact.id,
      run_status: run.status,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/collection-jobs/[id]/artifact");
  }
}
