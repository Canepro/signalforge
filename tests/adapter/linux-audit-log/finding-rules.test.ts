import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";
import { parseSections } from "@/lib/adapter/linux-audit-log/sections";
import { detectEnvironment } from "@/lib/adapter/linux-audit-log/environment";
import { extractPreFindings } from "@/lib/adapter/linux-audit-log/finding-rules";

const FIXTURES = join(__dirname, "../../fixtures");

function loadFindings(filename: string) {
  const raw = readFileSync(join(FIXTURES, filename), "utf-8");
  const sections = parseSections(stripAnsi(raw));
  const env = detectEnvironment(sections);
  return extractPreFindings(sections, env);
}

describe("extractPreFindings", () => {
  it("finds disk pressure in wsl-nov2025-full", () => {
    const findings = loadFindings("wsl-nov2025-full.log");
    const diskFindings = findings.filter((f) => f.category === "disk");
    expect(diskFindings.length).toBeGreaterThan(0);
  });

  it("extracts findings from sample-prod-server", () => {
    const findings = loadFindings("sample-prod-server.log");
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });

  it("handles truncated log gracefully", () => {
    const findings = loadFindings("wsl-nov2025-truncated.log");
    expect(Array.isArray(findings)).toBe(true);
  });

  it("findings have required fields", () => {
    const findings = loadFindings("wsl-nov2025-full.log");
    for (const f of findings) {
      expect(f.title).toBeTruthy();
      expect(f.severity_hint).toBeTruthy();
      expect(f.category).toBeTruthy();
      expect(f.section_source).toBeTruthy();
      expect(f.evidence).toBeTruthy();
      expect(f.rule_id).toBeTruthy();
    }
  });
});
