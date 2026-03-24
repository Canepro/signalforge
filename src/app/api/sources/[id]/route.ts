import { NextRequest, NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/api/admin-auth";
import { getStorage } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const storage = await getStorage();
    const row = await storage.sources.getById(id);
    if (!row) {
      return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const forbidden = ["target_identifier", "source_type", "expected_artifact_type"];
    for (const k of forbidden) {
      if (k in body) {
        return NextResponse.json(
          { error: `Cannot change ${k} in v1`, code: "immutable_field" },
          { status: 400 }
        );
      }
    }

    const storage = await getStorage();
    const existing = await storage.sources.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.display_name === "string") patch.display_name = body.display_name;
    if (typeof body.default_collector_type === "string")
      patch.default_collector_type = body.default_collector_type;
    if (body.default_collector_version !== undefined) {
      patch.default_collector_version =
        body.default_collector_version === null ? null : String(body.default_collector_version);
    }
    if (Array.isArray(body.capabilities)) {
      patch.capabilities = body.capabilities.filter((x): x is string => typeof x === "string");
    }
    if (body.labels && typeof body.labels === "object" && body.labels !== null) {
      patch.labels = Object.fromEntries(
        Object.entries(body.labels as Record<string, unknown>).filter(
          ([k, v]) => typeof k === "string" && typeof v === "string"
        )
      ) as Record<string, string>;
    }
    if (body.attributes && typeof body.attributes === "object" && body.attributes !== null) {
      patch.attributes = body.attributes as Record<string, unknown>;
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    const row = await storage.withTransaction((tx) => tx.sources.update(id, patch));
    return NextResponse.json(row!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const storage = await getStorage();
    const result = await storage.withTransaction((tx) => tx.sources.delete(id));
    if (!result.ok) {
      if (result.code === "not_found") {
        return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
      }
      if (result.code === "active_jobs") {
        return NextResponse.json(
          { error: "Source has claimed or running jobs", code: "active_jobs" },
          { status: 409 }
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
