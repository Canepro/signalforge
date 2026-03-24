import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import {
  collectionJobToJson,
  getCollectionJobById,
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
    const { id } = await params;
    const db = await getDb();
    reapExpiredCollectionJobLeases(db);
    const row = getCollectionJobById(db, id);
    saveDb();
    if (!row) {
      return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json(collectionJobToJson(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
