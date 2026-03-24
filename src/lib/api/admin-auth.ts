import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function getAdminTokenFromEnv(): string | null {
  const t = process.env.SIGNALFORGE_ADMIN_TOKEN;
  if (!t || !t.trim()) return null;
  return t.trim();
}

/**
 * Validates `Authorization: Bearer <token>` against `SIGNALFORGE_ADMIN_TOKEN`.
 * Returns a JSON NextResponse on failure, or `null` when OK.
 */
export function requireAdminBearer(request: NextRequest): NextResponse | null {
  const expected = getAdminTokenFromEnv();
  if (!expected) {
    return NextResponse.json(
      {
        error: "Admin API disabled: SIGNALFORGE_ADMIN_TOKEN is not set",
        code: "admin_token_unconfigured",
      },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const provided = auth.slice(7).trim();
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }

  return null;
}

const COOKIE_SALT = "signalforge_admin_cookie_v1";

async function subtleCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle;
  const { webcrypto } = await import("node:crypto");
  return webcrypto.subtle as unknown as SubtleCrypto;
}

/** SHA-256 hex of session cookie (Web Crypto — safe for Edge middleware + Node). */
export async function hashAdminSessionCookie(adminToken: string): Promise<string> {
  const msg = `${COOKIE_SALT}\0${adminToken}`;
  const data = new TextEncoder().encode(msg);
  const digest = await (await subtleCrypto()).digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualAscii(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyAdminSessionCookie(cookieValue: string | undefined): Promise<boolean> {
  const expected = getAdminTokenFromEnv();
  if (!expected || !cookieValue) return false;
  try {
    const want = await hashAdminSessionCookie(expected);
    return timingSafeEqualAscii(cookieValue, want);
  } catch {
    return false;
  }
}

export const ADMIN_SESSION_COOKIE = "sf_admin_session";
