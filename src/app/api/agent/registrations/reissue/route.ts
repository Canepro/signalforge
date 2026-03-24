import { NextRequest, NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/api/admin-auth";
import { getStorage } from "@/lib/storage";

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

    const storage = await getStorage();
    try {
      const { row, plainToken, token_prefix } = await storage.withTransaction((tx) =>
        tx.agents.rotateRegistration(source_id)
      );
      return NextResponse.json(
        {
          agent_id: row.id,
          source_id: row.source_id,
          token: plainToken,
          token_prefix,
          reissued: true,
        },
        { status: 200 }
      );
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "source_not_found") {
        return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
      }
      if (code === "registration_not_found") {
        return NextResponse.json(
          { error: "This source does not have an agent registration", code: "registration_not_found" },
          { status: 404 }
        );
      }
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
