import { NextRequest, NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/api/admin-auth";
import { createCollectionAgentRegistration } from "@/lib/api/collection-agent-registration";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

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

    return createCollectionAgentRegistration(body, "POST /agent/auth", {
      includeScopes: true,
    });
  } catch (err) {
    return internalServerErrorResponse(err, "POST /agent/auth");
  }
}
