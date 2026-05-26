import { NextResponse } from "next/server";
import { COLLECTION_AGENT_SCOPES } from "@/lib/auth-md/scopes";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export type CollectionAgentRegistrationBody = {
  source_id?: unknown;
  display_name?: unknown;
};

export async function createCollectionAgentRegistration(
  body: CollectionAgentRegistrationBody,
  logLabel: string,
  options?: { includeScopes?: boolean }
): Promise<NextResponse> {
  const source_id = typeof body.source_id === "string" ? body.source_id : "";
  if (!source_id) {
    return NextResponse.json(
      { error: "source_id is required", code: "validation_error" },
      { status: 400 }
    );
  }

  const display_name =
    typeof body.display_name === "string" ? body.display_name : null;

  const storage = await getStorage();
  try {
    const { row, plainToken, token_prefix } = await storage.withTransaction((tx) =>
      tx.agents.createRegistration(source_id, display_name)
    );

    const payload: Record<string, unknown> = {
      agent_id: row.id,
      source_id: row.source_id,
      token: plainToken,
      token_prefix,
    };

    if (options?.includeScopes) {
      payload.scopes = [...COLLECTION_AGENT_SCOPES];
      payload.rotation_guidance =
        "Store this token in the execution agent local secret store. Reissue via Sources UI if lost. Plaintext is returned once.";
      payload.compatibility = {
        agent_api_prefix: "/api/agent",
        legacy_register_path: "/api/agent/registrations",
      };
    }

    return NextResponse.json(payload, { status: 201 });
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
    return internalServerErrorResponse(e, logLabel);
  }
}
