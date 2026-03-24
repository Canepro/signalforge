import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import {
  collectionJobToJson,
  getSourceById,
  insertCollectionJob,
  listCollectionJobsForSource,
  reapExpiredCollectionJobLeases,
} from "@/lib/db/source-job-repository";
import { requireAdminBearer } from "@/lib/api/admin-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id: sourceId } = await params;
    const db = await getDb();
    const source = getSourceById(db, sourceId);
    if (!source) {
      return NextResponse.json({ error: "Source not found", code: "not_found" }, { status: 404 });
    }

    reapExpiredCollectionJobLeases(db);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const jobs = listCollectionJobsForSource(db, sourceId, status ? { status } : undefined);
    saveDb();
    return NextResponse.json({ jobs: jobs.map(collectionJobToJson) });
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
    const db = await getDb();
    const source = getSourceById(db, sourceId);
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
      const { row, inserted } = insertCollectionJob(db, source, {
        request_reason:
          typeof body.request_reason === "string" ? body.request_reason : null,
        priority: typeof body.priority === "number" ? body.priority : 0,
        idempotency_key:
          typeof body.idempotency_key === "string" ? body.idempotency_key : null,
      });
      saveDb();
      return NextResponse.json(collectionJobToJson(row), { status: inserted ? 201 : 200 });
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
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
