import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";
import { parseSections } from "@/lib/adapter/linux-audit-log/sections";
import { detectIncomplete } from "@/lib/adapter/linux-audit-log/incomplete";

const FIXTURES = join(__dirname, "../../fixtures");

function loadIncomplete(filename: string) {
  const raw = readFileSync(join(FIXTURES, filename), "utf-8");
  const sections = parseSections(stripAnsi(raw));
  return detectIncomplete(sections);
}

describe("detectIncomplete", () => {
  it("flags truncated log as incomplete", () => {
    const result = loadIncomplete("wsl-nov2025-truncated.log");
    expect(result.incomplete).toBe(true);
    expect(result.reason).toBeDefined();
  });

  it("full WSL Nov 2025 log is not incomplete", () => {
    const result = loadIncomplete("wsl-nov2025-full.log");
    expect(result.incomplete).toBe(false);
  });

  it("full WSL Mar 2026 log is not incomplete", () => {
    const result = loadIncomplete("wsl-mar2026-full.log");
    expect(result.incomplete).toBe(false);
  });

  it("sample prod server is not incomplete", () => {
    const result = loadIncomplete("sample-prod-server.log");
    expect(result.incomplete).toBe(false);
  });
});
