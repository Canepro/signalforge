import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";
import { parseSections, KNOWN_SECTIONS } from "@/lib/adapter/linux-audit-log/sections";

const FIXTURES = join(__dirname, "../../fixtures");

function loadAndParse(filename: string): Record<string, string> {
  const raw = readFileSync(join(FIXTURES, filename), "utf-8");
  return parseSections(stripAnsi(raw));
}

describe("parseSections", () => {
  it("extracts all 9 sections from wsl-nov2025-full", () => {
    const sections = loadAndParse("wsl-nov2025-full.log");
    for (const name of KNOWN_SECTIONS) {
      expect(sections[name], `missing section: ${name}`).toBeDefined();
      expect(sections[name].length).toBeGreaterThan(0);
    }
  });

  it("extracts all 9 sections from wsl-mar2026-full (with ANSI stripping)", () => {
    const sections = loadAndParse("wsl-mar2026-full.log");
    for (const name of KNOWN_SECTIONS) {
      expect(sections[name], `missing section: ${name}`).toBeDefined();
      expect(sections[name].length).toBeGreaterThan(0);
    }
  });

  it("extracts sections from sample-prod-server", () => {
    const sections = loadAndParse("sample-prod-server.log");
    expect(sections["SYSTEM IDENTITY"]).toBeDefined();
    expect(sections["NETWORK CONFIGURATION"]).toBeDefined();
  });

  it("extracts only available sections from truncated log", () => {
    const sections = loadAndParse("wsl-nov2025-truncated.log");
    expect(sections["SYSTEM IDENTITY"]).toBeDefined();
    expect(sections["NETWORK CONFIGURATION"]).toBeDefined();
    expect(sections["USER ACCOUNTS"]).toBeUndefined();
    expect(sections["INSTALLED PACKAGES"]).toBeUndefined();
  });

  it("section content does not include delimiters or headers", () => {
    const sections = loadAndParse("wsl-nov2025-full.log");
    const identity = sections["SYSTEM IDENTITY"];
    expect(identity).not.toContain("━━━");
    expect(identity).not.toContain("[SYSTEM IDENTITY]");
  });
});
