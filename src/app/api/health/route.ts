import { NextResponse } from "next/server";
import { getAppRuntimeHealthReport } from "@/lib/runtime/app-runtime-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = getAppRuntimeHealthReport();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
