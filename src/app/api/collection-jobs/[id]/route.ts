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
    const row = await storage.withTransaction(async (tx) => {
      await tx.jobs.reapExpiredLeases();
      return tx.jobs.getById(id);
    });
    if (!row) {
      return NextResponse.json({ error: "Job not found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
