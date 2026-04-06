import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hashAgentToken } from "@/lib/db/source-job-repository";
import { getStorage } from "@/lib/storage";
import type { AgentRegistrationView, SourceView } from "@/lib/storage/contract";

export type AgentRequestContext = {
  registration: AgentRegistrationView;
  source: SourceView;
};

/**
 * Bearer agent enrollment token → registration + source.
 */
export async function resolveAgentRequest(
  request: NextRequest
): Promise<{ ok: false; response: NextResponse } | ({ ok: true } & AgentRequestContext)> {
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
  const resolved = await storage.agents.resolveRequestContextByTokenHash(hashAgentToken(token));
  if (!resolved) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, registration: resolved.registration, source: resolved.source };
}
