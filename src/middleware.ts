import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  getAdminTokenFromEnv,
  verifyAdminSessionCookie,
} from "@/lib/api/admin-auth";

function isPublicLandingOnlyEnabled(): boolean {
  const raw = process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico"
  );
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/sources/login") ||
    pathname === "/api/health" ||
    pathname === "/auth.md" ||
    pathname.startsWith("/.well-known/")
  );
}

function isMachineRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/agent/") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/auth.md"
  );
}

function isRouteLevelBearerPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/agent/auth";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicLandingOnly = isPublicLandingOnlyEnabled();

  if (isStaticAssetPath(pathname) || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!publicLandingOnly && !pathname.startsWith("/sources")) {
    return NextResponse.next();
  }

  if (
    publicLandingOnly &&
    request.headers.get("authorization") &&
    isRouteLevelBearerPath(pathname)
  ) {
    return NextResponse.next();
  }

  if (!getAdminTokenFromEnv()) {
    if (isMachineRoute(pathname)) {
      return NextResponse.json(
        {
          error: "Private app auth is not configured",
          code: "private_app_auth_unconfigured",
        },
        { status: 503 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sources/login";
    url.searchParams.set("unconfigured", "1");
    return NextResponse.redirect(url);
  }

  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSessionCookie(cookie))) {
    if (isMachineRoute(pathname)) {
      return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sources/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
