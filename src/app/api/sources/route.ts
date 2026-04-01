import { NextRequest, NextResponse } from "next/server";
import { isSupportedArtifactType } from "@/lib/adapter/registry";
import { requireAdminBearer } from "@/lib/api/admin-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import {
  isCollectionScope,
  validateCollectionScopeForArtifactType,
  type CollectionScope,
} from "@/lib/collection-scope";
import { getStorage } from "@/lib/storage";
import { isSourceType, listSourceTypeOptions } from "@/lib/source-catalog";

export async function GET(request: NextRequest) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const storage = await getStorage();
    const { searchParams } = new URL(request.url);
    const enabled = searchParams.get("enabled");
    const sources =
      enabled === "true" ?
        await storage.sources.list({ enabled: true })
      : enabled === "false" ?
        await storage.sources.list({ enabled: false })
      : await storage.sources.list();

    return NextResponse.json({ sources });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/sources");
  }
}

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

    const display_name =
      typeof body.display_name === "string" ? body.display_name : "";
    const target_identifier =
      typeof body.target_identifier === "string" ? body.target_identifier : "";
    const source_type = typeof body.source_type === "string" ? body.source_type : "";
    const expected_artifact_type =
      typeof body.expected_artifact_type === "string" ? body.expected_artifact_type : "linux-audit-log";

    if (!display_name.trim() || display_name.length > 256) {
      return NextResponse.json(
        { error: "display_name is required (1–256 chars)", code: "validation_error" },
        { status: 400 }
      );
    }
    if (!target_identifier.trim() || target_identifier.length > 512) {
      return NextResponse.json(
        { error: "target_identifier is required (1–512 chars)", code: "validation_error" },
        { status: 400 }
      );
    }
    if (!isSourceType(source_type)) {
      const allowed = listSourceTypeOptions()
        .map((option) => option.value)
        .join(" | ");
      return NextResponse.json(
        { error: `source_type must be one of: ${allowed}`, code: "validation_error" },
        { status: 400 }
      );
    }
    if (
      typeof body.expected_artifact_type === "string" &&
      !isSupportedArtifactType(body.expected_artifact_type)
    ) {
      return NextResponse.json(
        {
          error: `Unsupported expected_artifact_type: "${body.expected_artifact_type}"`,
          code: "unsupported_artifact_type",
        },
        { status: 400 }
      );
    }
    let defaultCollectionScope: CollectionScope | null | undefined = undefined;
    if (body.default_collection_scope !== undefined && body.default_collection_scope !== null) {
      if (!isCollectionScope(body.default_collection_scope)) {
        return NextResponse.json(
          { error: "Invalid default_collection_scope payload", code: "invalid_default_collection_scope" },
          { status: 400 }
        );
      }
      const validation = validateCollectionScopeForArtifactType(
        body.default_collection_scope,
        expected_artifact_type
      );
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error, code: "invalid_default_collection_scope" },
          { status: 400 }
        );
      }
      defaultCollectionScope = body.default_collection_scope;
    }

    const storage = await getStorage();
    try {
      const row = await storage.withTransaction((tx) =>
        tx.sources.create({
          display_name,
          target_identifier,
          source_type,
          expected_artifact_type:
            typeof body.expected_artifact_type === "string" ?
              body.expected_artifact_type
            : undefined,
          default_collection_scope: defaultCollectionScope,
          default_collector_type:
            typeof body.default_collector_type === "string" ?
              body.default_collector_type
            : undefined,
          default_collector_version:
            typeof body.default_collector_version === "string" ?
              body.default_collector_version
            : null,
          capabilities: Array.isArray(body.capabilities) ?
            body.capabilities.filter((x): x is string => typeof x === "string")
          : undefined,
          attributes:
            body.attributes && typeof body.attributes === "object" && body.attributes !== null ?
              (body.attributes as Record<string, unknown>)
            : undefined,
          labels:
            body.labels && typeof body.labels === "object" && body.labels !== null ?
              (Object.fromEntries(
                Object.entries(body.labels as Record<string, unknown>).filter(
                  ([k, v]) => typeof k === "string" && typeof v === "string"
                )
              ) as Record<string, string>)
            : undefined,
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        })
      );
      return NextResponse.json(row, { status: 201 });
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      const msg = e instanceof Error ? e.message : String(e);
      if (code === "unsupported_artifact_type") {
        return NextResponse.json(
          {
            error: `Unsupported expected_artifact_type: "${body.expected_artifact_type}"`,
            code: "unsupported_artifact_type",
          },
          { status: 400 }
        );
      }
      if (code === "invalid_default_collection_scope") {
        return NextResponse.json(
          {
            error: "default_collection_scope does not match expected_artifact_type",
            code: "invalid_default_collection_scope",
          },
          { status: 400 }
        );
      }
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        return NextResponse.json(
          {
            error: "A source with this target_identifier already exists (enabled)",
            code: "duplicate_target_identifier",
          },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/sources");
  }
}
