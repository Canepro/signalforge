import { describe, expect, it, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, hashAdminSessionCookie } from "@/lib/api/admin-auth";
import { middleware } from "../middleware";

describe("private app middleware", () => {
  afterEach(() => {
    delete process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY;
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
  });

  it("leaves operational routes open when public landing mode is disabled", async () => {
    const res = await middleware(new NextRequest("http://localhost/dashboard"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps the landing page and health endpoint public", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";

    const landing = await middleware(new NextRequest("http://localhost/"));
    expect(landing.headers.get("x-middleware-next")).toBe("1");

    const health = await middleware(new NextRequest("http://localhost/api/health"));
    expect(health.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects protected UI routes to login without an admin session", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";

    const res = await middleware(new NextRequest("http://localhost/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/sources/login?next=%2Fdashboard");
  });

  it("allows protected UI routes with an admin session cookie", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";
    const cookie = await hashAdminSessionCookie("admin-token");

    const res = await middleware(
      new NextRequest("http://localhost/dashboard", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
      })
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns 401 for protected machine routes without Bearer or admin session", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";

    const res = await middleware(new NextRequest("http://localhost/api/runs"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "unauthorized" });
  });

  it("lets Bearer-authenticated machine routes reach route-level auth", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";

    const res = await middleware(
      new NextRequest("http://localhost/api/runs", {
        headers: { authorization: "Bearer route-token" },
      })
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not expose discovery documents with a fake Bearer header", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";

    const res = await middleware(
      new NextRequest("http://localhost/auth.md", {
        headers: { authorization: "Bearer anything" },
      })
    );
    expect(res.status).toBe(401);
  });
});
