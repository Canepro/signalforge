import { NextResponse } from "next/server";

/**
 * JSON body for unexpected server failures. Never includes raw exception text (avoid leaking internals).
 * Logs the real error on the server when not in test.
 */
export function internalServerErrorResponse(err: unknown, logLabel?: string): NextResponse {
  if (process.env.NODE_ENV !== "test") {
    const prefix = logLabel ? `[signalforge-api] ${logLabel}` : "[signalforge-api] internal error";
    console.error(prefix, err);
  }
  return NextResponse.json(
    { error: "Internal server error", code: "internal_error" },
    { status: 500 }
  );
}
