import { NextRequest, NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/api/admin-auth";
import { internalServerErrorResponse } from "@/lib/api/route-errors";
import { getStorage } from "@/lib/storage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const storage = await getStorage();
    try {
      const row = await storage.withTransaction((tx) => tx.jobs.cancel(id));
      if (!row) {
        return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json(row);
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
    return internalServerErrorResponse(err, "POST /api/collection-jobs/[id]/cancel");
  }
}
