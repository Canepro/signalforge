import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import {
  cancelCollectionJob,
  collectionJobToJson,
} from "@/lib/db/source-job-repository";
import { requireAdminBearer } from "@/lib/api/admin-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const db = await getDb();
    try {
      const row = cancelCollectionJob(db, id);
      if (!row) {
        return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
      }
      saveDb();
      return NextResponse.json(collectionJobToJson(row));
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "cannot_cancel_running") {
        return NextResponse.json(
          { error: "Cannot cancel a running job", code: "cannot_cancel_running" },
          { status: 409 }
        );
      }
      if (code === "already_terminal") {
        return NextResponse.json(
          { error: "Job is already in a terminal state", code: "already_terminal" },
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
