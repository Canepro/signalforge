import { NextRequest, NextResponse } from "next/server";
import {
  evaluateFixActionEligibility,
  KUBERNETES_SAFE_FIX_CAPABILITY,
} from "@/lib/automation/fix-policy";
import { resolveAutomationAgentRequest } from "@/lib/api/automation-agent-auth";
import { fixActionPollUrl } from "@/lib/api/fix-action-response";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const ctx = await resolveAutomationAgentRequest(request);
  if (!ctx.ok) return ctx.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "invalid_json" }, { status: 400 });
  }

  const signalId = typeof body.signal_id === "string" ? body.signal_id.trim() : "";
  const diagnosticRequestId =
    typeof body.diagnostic_request_id === "string" ? body.diagnostic_request_id.trim() : "";
  const preFixRunId = typeof body.pre_fix_run_id === "string" ? body.pre_fix_run_id.trim() : "";
  const idempotencyKey =
    typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : null;

  if (!signalId || !diagnosticRequestId || !preFixRunId) {
    return NextResponse.json(
      { error: "signal_id, diagnostic_request_id, and pre_fix_run_id are required", code: "validation_error" },
      { status: 400 }
    );
  }

  try {
    const storage = await getStorage();
    const result = await storage.withTransaction(async (tx) => {
      const signal = await tx.automationSignals.getById(signalId);
      if (!signal) return { kind: "not_found" as const };
      if (signal.source_id !== ctx.source.id) return { kind: "forbidden" as const };

      const job = await tx.jobs.getById(diagnosticRequestId);
      if (!job) return { kind: "diagnostic_not_found" as const };
      if (job.source_id !== ctx.source.id) return { kind: "forbidden" as const };
      if (job.trigger_signal_id !== signal.id) return { kind: "diagnostic_mismatch" as const };
      if (job.result_run_id !== preFixRunId) return { kind: "pre_fix_run_mismatch" as const };

      const run = await tx.runs.getApiDetail(preFixRunId);
      if (!run) return { kind: "run_not_found" as const };
      if (signal.run_id !== preFixRunId) return { kind: "stale_run" as const };

      const registration = await tx.agents.getRegistrationBySourceId(ctx.source.id);
      let lastCaps: string[] = [];
      try {
        lastCaps = registration?.last_capabilities_json ?
          JSON.parse(registration.last_capabilities_json) as string[]
        : [];
      } catch {
        lastCaps = [];
      }
      if (
        !ctx.source.capabilities.includes(KUBERNETES_SAFE_FIX_CAPABILITY) ||
        !lastCaps.includes(KUBERNETES_SAFE_FIX_CAPABILITY)
      ) {
        return { kind: "capability_mismatch" as const };
      }

      const finding = run.report?.findings.find((item) => item.id === signal.finding_id) ?? null;
      const eligibility = evaluateFixActionEligibility({
        source: ctx.source,
        run,
        finding,
      });
      if (!eligibility.eligible) return { kind: "not_eligible" as const, eligibility };

      const created = await tx.fixActionRuns.create({
        sourceId: ctx.source.id,
        signalId: signal.id,
        diagnosticRequestId: job.id,
        preFixRunId,
        findingId: signal.finding_id,
        policyId: eligibility.policy_id,
        actionKind: eligibility.action_kind,
        actionPayload: eligibility.action_payload,
        requestedBy: `automation_agent:${ctx.registration.id}`,
        idempotencyKey,
      });
      return { kind: "ok" as const, created };
    });

    if (result.kind === "not_found" || result.kind === "diagnostic_not_found" || result.kind === "run_not_found") {
      return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
    }
    if (result.kind === "forbidden") {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }
    if (result.kind === "diagnostic_mismatch" || result.kind === "pre_fix_run_mismatch") {
      return NextResponse.json({ error: "Diagnostic request does not match signal/run", code: result.kind }, { status: 409 });
    }
    if (result.kind === "stale_run") {
      return NextResponse.json({ error: "pre_fix_run_id is not the latest run for this signal", code: "stale_run" }, { status: 409 });
    }
    if (result.kind === "capability_mismatch") {
      return NextResponse.json({ error: "Kubernetes safe-fix capability is not available", code: "capability_mismatch" }, { status: 409 });
    }
    if (result.kind === "not_eligible") {
      return NextResponse.json(
        { error: result.eligibility.reason, code: result.eligibility.code },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        action_run_id: result.created.row.id,
        source_id: result.created.row.source_id,
        status: "queued",
        policy_id: result.created.row.policy_id,
        action_kind: result.created.row.action_kind,
        action_payload: result.created.row.action_payload,
        poll_url: fixActionPollUrl(result.created.row.id),
      },
      { status: result.created.inserted ? 201 : 200 }
    );
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/automation-agent/fix-action-runs");
  }
}
