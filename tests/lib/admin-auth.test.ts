import { webcrypto } from "node:crypto";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  getAdminTokenFromEnv,
  getRunsApiTokenFromEnv,
  hashAdminSessionCookie,
  isAdminTokenCandidate,
  requireAdminRequest,
  requireAdminBearer,
  requireRunsApiRequest,
  shouldRequireRunsApiAuth,
  verifyAdminSessionCookie,
} from "@/lib/api/admin-auth";

describe("admin-auth", () => {
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto ?? webcrypto,
      configurable: true,
    });
  });

  afterEach(() => {
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
    delete process.env.SIGNALFORGE_RUNS_API_TOKEN;
    delete process.env.SIGNALFORGE_RUNS_REQUIRE_AUTH;
    delete process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY;
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  });

  it("requireAdminBearer returns 503 when token unset", () => {
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
    const req = new NextRequest("http://localhost/api/sources", { method: "GET" });
    const res = requireAdminBearer(req);
    expect(res?.status).toBe(503);
  });

  it("requireAdminBearer returns 401 without Authorization", () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "secret-token";
    const req = new NextRequest("http://localhost/api/sources", { method: "GET" });
    const res = requireAdminBearer(req);
    expect(res?.status).toBe(401);
  });

  it("requireAdminBearer returns 403 for wrong token", () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "secret-token";
    const req = new NextRequest("http://localhost/api/sources", {
      method: "GET",
      headers: { authorization: "Bearer wrong" },
    });
    const res = requireAdminBearer(req);
    expect(res?.status).toBe(403);
  });

  it("requireAdminBearer returns null for correct Bearer", () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "secret-token";
    const req = new NextRequest("http://localhost/api/sources", {
      method: "GET",
      headers: { authorization: "Bearer secret-token" },
    });
    expect(requireAdminBearer(req)).toBeNull();
  });

  it("hashAdminSessionCookie and verifyAdminSessionCookie agree", async () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "abc";
    const hex = await hashAdminSessionCookie("abc");
    expect(hex.length).toBe(64);
    expect(await verifyAdminSessionCookie(hex)).toBe(true);
    expect(await verifyAdminSessionCookie("deadbeef")).toBe(false);
  });

  it("requireAdminRequest accepts the admin session cookie", async () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "cookie-token";
    const cookie = await hashAdminSessionCookie("cookie-token");
    const req = new NextRequest("http://localhost/api/runs/id/reanalyze", {
      method: "POST",
      headers: { cookie: `sf_admin_session=${cookie}` },
    });
    await expect(requireAdminRequest(req)).resolves.toBeNull();
  });

  it("requireAdminRequest returns 401 without bearer or admin cookie", async () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "cookie-token";
    const req = new NextRequest("http://localhost/api/runs/id/reanalyze", { method: "POST" });
    const res = await requireAdminRequest(req);
    expect(res?.status).toBe(401);
  });

  it("requireRunsApiRequest is open by default", async () => {
    const req = new NextRequest("http://localhost/api/runs", { method: "GET" });
    await expect(requireRunsApiRequest(req)).resolves.toBeNull();
    expect(shouldRequireRunsApiAuth()).toBe(false);
  });

  it("requireRunsApiRequest accepts the dedicated runs bearer when enabled", async () => {
    process.env.SIGNALFORGE_RUNS_API_TOKEN = "runs-token";
    const req = new NextRequest("http://localhost/api/runs", {
      method: "GET",
      headers: { authorization: "Bearer runs-token" },
    });
    await expect(requireRunsApiRequest(req)).resolves.toBeNull();
    expect(getRunsApiTokenFromEnv()).toBe("runs-token");
    expect(shouldRequireRunsApiAuth()).toBe(true);
  });

  it("requireRunsApiRequest returns 401 when runs auth is enabled without credentials", async () => {
    process.env.SIGNALFORGE_RUNS_API_TOKEN = "runs-token";
    const req = new NextRequest("http://localhost/api/runs", { method: "GET" });
    const res = await requireRunsApiRequest(req);
    expect(res?.status).toBe(401);
  });

  it("public landing mode forces runs API auth", async () => {
    process.env.SIGNALFORGE_PUBLIC_LANDING_ONLY = "true";
    process.env.SIGNALFORGE_ADMIN_TOKEN = "admin-token";
    expect(shouldRequireRunsApiAuth()).toBe(true);

    const missing = await requireRunsApiRequest(
      new NextRequest("http://localhost/api/runs", { method: "GET" })
    );
    expect(missing?.status).toBe(401);

    const admin = await requireRunsApiRequest(
      new NextRequest("http://localhost/api/runs", {
        method: "GET",
        headers: { authorization: "Bearer admin-token" },
      })
    );
    expect(admin).toBeNull();
  });

  it("getAdminTokenFromEnv trims whitespace", () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "  x  ";
    expect(getAdminTokenFromEnv()).toBe("x");
  });

  it("checks login token candidates with the shared timing-safe comparator", () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "secret-token";
    expect(isAdminTokenCandidate("secret-token")).toBe(true);
    expect(isAdminTokenCandidate("wrong-token")).toBe(false);
  });

  it("getAdminTokenFromEnv can read from an explicit env snapshot", () => {
    expect(
      getAdminTokenFromEnv({
        ...process.env,
        SIGNALFORGE_ADMIN_TOKEN: "  scoped-secret  ",
      })
    ).toBe("scoped-secret");
  });
});
