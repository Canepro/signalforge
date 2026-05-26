import { NextRequest, NextResponse } from "next/server";
import { buildAutomationDiagnosticRequestResponse } from "@/lib/api/automation-diagnostic-response";
import { resolveAutomationAgentRequest } from "@/lib/api/automation-agent-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveAutomationAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  try {
    const { id } = await params;
    const storage = await getStorage();
    const payload = await storage.withTransaction(async (tx) => {
      const job = await tx.jobs.getById(id);
      if (!job) return { kind: "not_found" as const };
      if (job.source_id !== ctx.source.id) return { kind: "forbidden" as const };

      const run =
        job.result_run_id ? await tx.runs.getApiDetail(job.result_run_id) : null;
      if (job.result_run_id && !run) {
        throw new Error(`Linked run ${job.result_run_id} not found for automation diagnostic request ${job.id}`);
      }

      return { kind: "ok" as const, job, run };
    });

    if (payload.kind === "not_found") {
      return NextResponse.json({ error: "Diagnostic request not found", code: "not_found" }, { status: 404 });
    }

    if (payload.kind === "forbidden") {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }

    return NextResponse.json(buildAutomationDiagnosticRequestResponse(payload.job, payload.run));
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/automation-agent/diagnostic-requests/[id]");
  }
}
