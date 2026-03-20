import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";
import { parseSections } from "@/lib/adapter/linux-audit-log/sections";
import { detectEnvironment } from "@/lib/adapter/linux-audit-log/environment";
import { classifyNoise } from "@/lib/adapter/linux-audit-log/noise-rules";

const FIXTURES = join(__dirname, "../../fixtures");

function loadNoise(filename: string) {
  const raw = readFileSync(join(FIXTURES, filename), "utf-8");
  const sections = parseSections(stripAnsi(raw));
  const env = detectEnvironment(sections);
  return { noise: classifyNoise(sections, env), env };
}

describe("classifyNoise", () => {
  it("classifies WSL noise for wsl-nov2025-full", () => {
    const { noise } = loadNoise("wsl-nov2025-full.log");
    const observations = noise.map((n) => n.observation);
    expect(observations).toContain("SSH service not found");
    expect(observations).toContain("AppArmor not present");
  });

  it("classifies WSL noise for wsl-mar2026-full", () => {
    const { noise } = loadNoise("wsl-mar2026-full.log");
    expect(noise.length).toBeGreaterThan(0);
    const envTypes = noise.map((n) => n.related_environment);
    expect(envTypes).toContain("WSL");
  });

  it("produces no WSL noise for sample prod server", () => {
    const { noise } = loadNoise("sample-prod-server.log");
    const wslNoise = noise.filter((n) => n.related_environment === "WSL");
    expect(wslNoise).toHaveLength(0);
  });

  it("classifies non-root noise for Mar 2026 log (not run as root)", () => {
    const { noise, env } = loadNoise("wsl-mar2026-full.log");
    expect(env.ran_as_root).toBe(false);
    const nonRootNoise = noise.filter(
      (n) => n.related_environment === "non-root"
    );
    expect(nonRootNoise.length).toBeGreaterThan(0);
  });
});
