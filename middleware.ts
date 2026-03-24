import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  getAdminTokenFromEnv,
  verifyAdminSessionCookie,
} from "@/lib/api/admin-auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/sources")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/sources/login")) {
    return NextResponse.next();
  }

  if (!getAdminTokenFromEnv()) {
    const url = request.nextUrl.clone();
    url.pathname = "/sources/login";
    url.searchParams.set("unconfigured", "1");
    return NextResponse.redirect(url);
  }

  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSessionCookie(cookie))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sources/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/sources", "/sources/:path*"] as const,
};
