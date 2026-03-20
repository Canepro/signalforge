import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRun } from "@/lib/db/repository";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const run = getRun(db, id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!run.report_json) {
      return NextResponse.json({ error: "No report available" }, { status: 404 });
    }

    return NextResponse.json(JSON.parse(run.report_json));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
