import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import { createAgentRegistration } from "@/lib/db/source-job-repository";
import { requireAdminBearer } from "@/lib/api/admin-auth";

export async function POST(request: NextRequest) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const source_id = typeof body.source_id === "string" ? body.source_id : "";
    if (!source_id) {
      return NextResponse.json(
        { error: "source_id is required", code: "validation_error" },
        { status: 400 }
      );
    }

    const display_name =
      typeof body.display_name === "string" ? body.display_name : null;

    const db = await getDb();
    try {
      const { row, plainToken, token_prefix } = createAgentRegistration(
        db,
        source_id,
        display_name
      );
      saveDb();
      return NextResponse.json(
        {
          agent_id: row.id,
          source_id: row.source_id,
          token: plainToken,
          token_prefix,
        },
        { status: 201 }
      );
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "source_not_found") {
        return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
      }
      if (code === "source_already_registered") {
        return NextResponse.json(
          {
            error: "This source already has an agent registration",
            code: "source_already_registered",
          },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
