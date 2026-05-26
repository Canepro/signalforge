import type { NextRequest } from "next/server";

/** Resolve the public origin used in auth.md and well-known discovery documents. */
export function resolvePublicBaseUrl(request: NextRequest): string {
  const configured = process.env.SIGNALFORGE_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}
