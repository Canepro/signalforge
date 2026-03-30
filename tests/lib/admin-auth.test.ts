import { webcrypto } from "node:crypto";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  getAdminTokenFromEnv,
  hashAdminSessionCookie,
  requireAdminBearer,
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

  it("getAdminTokenFromEnv trims whitespace", () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = "  x  ";
    expect(getAdminTokenFromEnv()).toBe("x");
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
