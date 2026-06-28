import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function getAdminTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = env.SIGNALFORGE_ADMIN_TOKEN;
  if (!t || !t.trim()) return null;
  return t.trim();
}

export function getRunsApiTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = env.SIGNALFORGE_RUNS_API_TOKEN;
  if (!t || !t.trim()) return null;
  return t.trim();
}

export function shouldRequireRunsApiAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SIGNALFORGE_RUNS_REQUIRE_AUTH?.trim().toLowerCase();
  const privateAppRaw = env.SIGNALFORGE_PUBLIC_LANDING_ONLY?.trim().toLowerCase();
  const publicLandingOnly =
    privateAppRaw === "1" || privateAppRaw === "true" || privateAppRaw === "yes";
  return Boolean(
    publicLandingOnly ||
      getRunsApiTokenFromEnv(env) ||
      raw === "1" ||
      raw === "true" ||
      raw === "yes"
  );
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
  if (!timingSafeEqualAscii(provided, expected)) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }

  return null;
}

export async function requireAdminRequest(request: NextRequest): Promise<NextResponse | null> {
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
  if (auth) {
    return requireAdminBearer(request);
  }

  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (await verifyAdminSessionCookie(cookieValue)) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
}

export async function requireRunsApiRequest(request: NextRequest): Promise<NextResponse | null> {
  if (!shouldRequireRunsApiAuth()) {
    return null;
  }

  const runsToken = getRunsApiTokenFromEnv();
  const adminToken = getAdminTokenFromEnv();
  if (!runsToken && !adminToken) {
    return NextResponse.json(
      {
        error: "Runs API auth enabled but no token is configured",
        code: "runs_api_auth_unconfigured",
      },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization");
  if (auth) {
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json(runsApiUnauthorizedBody(), { status: 401 });
    }
    const provided = auth.slice(7).trim();
    if (
      (runsToken && timingSafeEqualAscii(provided, runsToken)) ||
      (adminToken && timingSafeEqualAscii(provided, adminToken))
    ) {
      return null;
    }
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }

  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (adminToken && (await verifyAdminSessionCookie(cookieValue))) {
    return null;
  }

  return NextResponse.json(runsApiUnauthorizedBody(), { status: 401 });
}

export function runsApiUnauthorizedBody() {
  return {
    error: "Unauthorized",
    code: "unauthorized",
    auth_required: {
      browser: "Sign in at /sources/login, then use the admin session cookie",
      api: "Send Authorization: Bearer with SIGNALFORGE_RUNS_API_TOKEN or SIGNALFORGE_ADMIN_TOKEN",
      login_path: "/sources/login",
    },
  };
}

const COOKIE_SALT = "signalforge_admin_cookie_v1";

async function subtleCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle;
  throw new Error("Web Crypto API is unavailable");
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

export function timingSafeEqualAscii(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdminTokenCandidate(candidate: string): boolean {
  const expected = getAdminTokenFromEnv();
  return Boolean(expected && timingSafeEqualAscii(candidate.trim(), expected));
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
