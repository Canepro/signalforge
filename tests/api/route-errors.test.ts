import { describe, it, expect } from "vitest";
import { internalServerErrorResponse } from "@/lib/api/route-errors";

describe("internalServerErrorResponse", () => {
  it("returns stable JSON without echoing the thrown message", async () => {
    const res = internalServerErrorResponse(new Error("do not leak this"), "test-op");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error", code: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("leak");
  });
});
