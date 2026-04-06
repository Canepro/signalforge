import { NextRequest, NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/api/admin-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import {
  isCollectionScope,
  validateCollectionScopeForArtifactType,
  type CollectionScope,
} from "@/lib/collection-scope";
import { getStorage } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id: sourceId } = await params;
    const storage = await getStorage();
    const source = await storage.sources.getById(sourceId);
    if (!source) {
      return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const jobs = await storage.jobs.listForSource(sourceId, status ? { status } : undefined);
    return NextResponse.json({ jobs });
  } catch (err) {
    return internalServerErrorResponse(err, "GET /api/sources/[id]/collection-jobs");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id: sourceId } = await params;
    const storage = await getStorage();
    const source = await storage.sources.getById(sourceId);
    if (!source) {
      return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
    }

    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    try {
      let collectionScope: CollectionScope | null = null;
      if (body.collection_scope !== undefined && body.collection_scope !== null) {
        if (!isCollectionScope(body.collection_scope)) {
          return NextResponse.json(
            { error: "Invalid collection_scope payload", code: "invalid_collection_scope" },
            { status: 400 }
          );
        }
        const validation = validateCollectionScopeForArtifactType(
          body.collection_scope,
          source.expected_artifact_type
        );
        if (!validation.ok) {
          return NextResponse.json(
            { error: validation.error, code: "invalid_collection_scope" },
            { status: 400 }
          );
        }
        collectionScope = body.collection_scope;
      }

      const { row, inserted } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(sourceId, {
          request_reason:
            typeof body.request_reason === "string" ? body.request_reason : null,
          priority: typeof body.priority === "number" ? body.priority : 0,
          idempotency_key:
            typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          collection_scope: collectionScope,
        })
      );
      return NextResponse.json(row, { status: inserted ? 201 : 200 });
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "source_not_found") {
        return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
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
      if (code === "source_disabled") {
        return NextResponse.json(
          { error: "Source is disabled", code: "source_disabled" },
          { status: 409 }
        );
      }
      if (code === "invalid_collection_scope") {
        return NextResponse.json(
          { error: "Invalid collection_scope for this source artifact type", code: "invalid_collection_scope" },
          { status: 400 }
        );
      }
      throw e;
    }
  } catch (err) {
    return internalServerErrorResponse(err, "POST /api/sources/[id]/collection-jobs");
  }
}
