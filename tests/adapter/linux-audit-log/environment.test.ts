import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";
import { parseSections } from "@/lib/adapter/linux-audit-log/sections";
import { detectEnvironment } from "@/lib/adapter/linux-audit-log/environment";

const FIXTURES = join(__dirname, "../../fixtures");

function loadEnv(filename: string) {
  const raw = readFileSync(join(FIXTURES, filename), "utf-8");
  const sections = parseSections(stripAnsi(raw));
  return detectEnvironment(sections);
}

describe("detectEnvironment", () => {
  it("detects WSL for wsl-nov2025-full", () => {
    const env = loadEnv("wsl-nov2025-full.log");
    expect(env.is_wsl).toBe(true);
    expect(env.hostname).toBe("MogahPC");
    expect(env.os).toContain("Ubuntu");
    expect(env.kernel).toContain("microsoft-standard-WSL2");
    expect(env.is_container).toBe(false);
  });

  it("detects WSL for wsl-mar2026-full", () => {
    const env = loadEnv("wsl-mar2026-full.log");
    expect(env.is_wsl).toBe(true);
    expect(env.kernel).toContain("microsoft-standard-WSL2");
  });

  it("detects WSL for truncated log", () => {
    const env = loadEnv("wsl-nov2025-truncated.log");
    expect(env.is_wsl).toBe(true);
  });

  it("detects non-WSL for sample prod server", () => {
    const env = loadEnv("sample-prod-server.log");
    expect(env.is_wsl).toBe(false);
    expect(env.os).toContain("Ubuntu");
  });

  it("detects root for WSL Nov 2025 log (ran with sudo)", () => {
    const env = loadEnv("wsl-nov2025-full.log");
    expect(env.ran_as_root).toBe(true);
  });

  it("detects non-root for WSL Mar 2026 log", () => {
    const env = loadEnv("wsl-mar2026-full.log");
    expect(env.ran_as_root).toBe(false);
  });
});
