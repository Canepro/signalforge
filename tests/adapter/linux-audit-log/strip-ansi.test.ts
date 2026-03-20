import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";

const FIXTURES = join(__dirname, "../../fixtures");

describe("stripAnsi", () => {
  it("removes ANSI escape codes from text", () => {
    const input = "\x1b[0;32m→\x1b[0m Hostname";
    expect(stripAnsi(input)).toBe("→ Hostname");
  });

  it("leaves clean text unchanged", () => {
    const input = "→ Hostname";
    expect(stripAnsi(input)).toBe("→ Hostname");
  });

  it("handles the Mar 2026 log which contains ANSI codes", () => {
    const raw = readFileSync(join(FIXTURES, "wsl-mar2026-full.log"), "utf-8");
    expect(raw).toContain("\x1b[");
    const clean = stripAnsi(raw);
    expect(clean).not.toContain("\x1b[");
    expect(clean).toContain("Hostname");
    expect(clean).toContain("SYSTEM IDENTITY");
  });

  it("strips ANSI codes from the Nov 2025 log", () => {
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");
    const clean = stripAnsi(raw);
    expect(clean).not.toContain("\x1b[");
    expect(clean).toContain("Hostname");
    expect(clean).toContain("SYSTEM IDENTITY");
  });
});
