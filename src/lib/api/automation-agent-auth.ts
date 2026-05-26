import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hashAgentToken } from "@/lib/db/source-job-repository";
import { getStorage } from "@/lib/storage";
import type {
  AutomationAgentRegistrationView,
  SourceView,
} from "@/lib/storage/contract";

export type AutomationAgentRequestContext = {
  registration: AutomationAgentRegistrationView;
  source: SourceView;
};

/**
 * Bearer automation-agent token -> registration + source.
 */
export async function resolveAutomationAgentRequest(
  request: NextRequest
): Promise<{ ok: false; response: NextResponse } | ({ ok: true } & AutomationAgentRequestContext)> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
    };
  }

  const token = auth.slice(7).trim();
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
    };
  }

  const storage = await getStorage();
  const resolved = await storage.withTransaction((tx) =>
    tx.automationAgents.resolveRequestContextByTokenHash(hashAgentToken(token))
  );
  if (!resolved) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, registration: resolved.registration, source: resolved.source };
}
