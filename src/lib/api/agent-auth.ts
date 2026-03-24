import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Database } from "sql.js";
import { getDb } from "@/lib/db/client";
import {
  getAgentRegistrationByTokenHash,
  getSourceById,
  hashAgentToken,
  reapExpiredCollectionJobLeases,
  type AgentRegistrationRow,
  type SourceRow,
} from "@/lib/db/source-job-repository";

export type AgentRequestContext = {
  db: Database;
  registration: AgentRegistrationRow;
  source: SourceRow;
};

/**
 * Bearer agent enrollment token → registration + source. Runs lease reaper (caller should `saveDb`).
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

  const db = await getDb();
  reapExpiredCollectionJobLeases(db);

  const reg = getAgentRegistrationByTokenHash(db, hashAgentToken(token));
  if (!reg) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
    };
  }

  const source = getSourceById(db, reg.source_id);
  if (!source) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, db, registration: reg, source };
}
