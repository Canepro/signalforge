import { NextRequest, NextResponse } from "next/server";
import { analyzeArtifact } from "@/lib/analyzer/index";
import {
  detectArtifactType,
  isSupportedArtifactType,
} from "@/lib/adapter/registry";
import { parseIngestionMeta, ingestionRecordFromFormData } from "@/lib/ingestion/meta";
import { resolveAgentRequest } from "@/lib/api/agent-auth";
import { emitRunLifecycleEvents } from "@/lib/domain-events";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  const { id: jobId } = await params;

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

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided", code: "file_required" }, { status: 400 });
  }

  const content = await file.text();
  const filename = file.name;
  const artifactType =
    (formData.get("artifact_type") as string) || undefined;
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
  if (!isSupportedArtifactType(resolvedType)) {
    return NextResponse.json(
      {
        error: `Unsupported artifact_type: "${resolvedType}"`,
        code: "unsupported_artifact_type",
      },
      { status: 400 }
    );
  }

  try {
    const result = await analyzeArtifact(content, { artifactType: resolvedType });
    const storage = await getStorage();
    const submitted = await storage.withTransaction((tx) =>
      tx.jobs.submitArtifactForAgent({
        jobId,
        sourceId: ctx.source.id,
        registrationId: ctx.registration.id,
        instanceId,
        artifactType: resolvedType,
        sourceType,
        filename,
        content,
        ingestion,
        analysis: result,
      })
    );

    if (!submitted.ok) {
      if (submitted.code === "not_found") {
        return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
      }
      if (submitted.code === "wrong_source") {
        return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
      }
      if (submitted.code === "artifact_type_mismatch") {
        return NextResponse.json(
          {
            error: "Uploaded artifact_type does not match the requested job artifact_type",
            code: "artifact_type_mismatch",
          },
          { status: 409 }
        );
      }
      if (submitted.code === "job_already_submitted") {
        return NextResponse.json(
          {
            error: "Job already submitted",
            code: "job_already_submitted",
            run_id: submitted.run_id,
            artifact_id: submitted.artifact_id,
          },
          { status: 409 }
        );
      }
      if (submitted.code === "instance_mismatch") {
        return NextResponse.json(
          { error: "instance_id does not match job lease", code: "instance_mismatch" },
          { status: 403 }
        );
      }
      if (submitted.code === "lease_expired") {
        return NextResponse.json({ error: "Lease expired", code: "lease_expired" }, { status: 409 });
      }
      if (submitted.code === "invalid_state") {
        return NextResponse.json(
          { error: "Job is not running under this agent lease", code: "invalid_state" },
          { status: 409 }
        );
      }
      if (submitted.code === "conflict") {
        return NextResponse.json(
          { error: "Job state changed during upload; retry with a new job if needed", code: "conflict" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Job is not running under this agent lease", code: "invalid_state" },
        { status: 409 }
      );
    }

    emitRunLifecycleEvents({
      run_id: submitted.run_id,
      artifact_id: submitted.artifact_id,
      source_id: ctx.source.id,
      job_id: jobId,
      status: submitted.run_status,
      analysis_error: result.analysis_error ?? null,
    });

    return NextResponse.json({
      job: {
        id: submitted.job.id,
        status: submitted.job.status,
        result_run_id: submitted.job.result_run_id,
        result_artifact_id: submitted.job.result_artifact_id,
        result_analysis_status: submitted.job.result_analysis_status ?? submitted.run_status,
      },
      run_id: submitted.run_id,
      artifact_id: submitted.artifact_id,
      run_status: submitted.run_status,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/collection-jobs/[id]/artifact");
  }
}
