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
    const { id: sourceId } = await params;
    const storage = await getStorage();
    const source = await storage.sources.getById(sourceId);
    if (!source) {
      return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const jobs = await storage.withTransaction(async (tx) => {
      await tx.jobs.reapExpiredLeases();
      return tx.jobs.listForSource(sourceId, status ? { status } : undefined);
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
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
      const { row, inserted } = await storage.withTransaction((tx) =>
        tx.jobs.queueForSource(sourceId, {
          request_reason:
            typeof body.request_reason === "string" ? body.request_reason : null,
          priority: typeof body.priority === "number" ? body.priority : 0,
          idempotency_key:
            typeof body.idempotency_key === "string" ? body.idempotency_key : null,
        })
      );
      return NextResponse.json(row, { status: inserted ? 201 : 200 });
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "source_not_found") {
        return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
      }
      if (code === "source_disabled") {
        return NextResponse.json(
          { error: "Source is disabled", code: "source_disabled" },
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
