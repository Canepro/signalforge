import { NextRequest, NextResponse } from "next/server";
import { buildAutomationDiagnosticRequestAcceptedResponse } from "@/lib/api/automation-diagnostic-response";
import { resolveAutomationAgentRequest } from "@/lib/api/automation-agent-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const ctx = await resolveAutomationAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  try {
    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const storage = await getStorage();
    try {
      const { row, inserted } = await storage.withTransaction((tx) =>
        (async () => {
          const triggerSignalId =
            typeof body.trigger_signal_id === "string" ? body.trigger_signal_id.trim() : "";
          if (triggerSignalId) {
            const signal = await tx.automationSignals.getById(triggerSignalId);
            if (!signal) {
              const err = new Error("signal_not_found") as Error & { code: string };
              err.code = "signal_not_found";
              throw err;
            }
            if (signal.source_id !== ctx.source.id) {
              const err = new Error("signal_forbidden") as Error & { code: string };
              err.code = "signal_forbidden";
              throw err;
            }
          }

          const queued = await tx.jobs.queueForSource(ctx.source.id, {
            request_reason: typeof body.request_reason === "string" ? body.request_reason : null,
            idempotency_key:
              typeof body.idempotency_key === "string" ? body.idempotency_key : null,
            requested_by: `automation_agent:${ctx.registration.id}`,
            trigger_signal_id: triggerSignalId || null,
          });

          if (triggerSignalId && queued.inserted) {
            await tx.automationSignals.markDiagnosticRequested(triggerSignalId, ctx.source.id);
          }
          return queued;
        })()
      );

      return NextResponse.json(buildAutomationDiagnosticRequestAcceptedResponse(row), {
        status: inserted ? 201 : 200,
      });
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "source_not_found") {
        return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
      }
      if (code === "source_disabled") {
        return NextResponse.json(
          { error: "Source is disabled", code: "source_disabled" },
          { status: 409 }
        );
      }
      if (code === "unsupported_artifact_type") {
        return NextResponse.json(
          {
            error: "Source expected_artifact_type is not supported by this SignalForge build",
            code: "unsupported_artifact_type",
          },
          { status: 409 }
        );
      }
      if (code === "signal_not_found") {
        return NextResponse.json(
          { error: "Automation signal not found", code: "not_found" },
          { status: 404 }
        );
      }
      if (code === "signal_forbidden") {
        return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
      }
      throw e;
    }
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/automation-agent/diagnostic-requests");
  }
}
