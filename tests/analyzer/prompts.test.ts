import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/analyzer/prompts";
import type { EnvironmentContext, NoiseItem, PreFinding } from "@/lib/analyzer/schema";

const baseEnv: EnvironmentContext = {
  hostname: "cluster-a",
  os: "Kubernetes (aks)",
  kernel: "namespace:payments",
  is_wsl: false,
  is_container: false,
  is_virtual_machine: false,
  ran_as_root: false,
  uptime: "unknown",
};

describe("analyzer prompts", () => {
  it("system prompt forbids inventing findings and changing severity", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Do NOT invent findings");
    expect(prompt).toContain("Do NOT change the severity");
    expect(prompt).toMatch(/Kubernetes operational signals/);
  });

  it("user prompt adds Kubernetes guidance for kubernetes-bundle environments", () => {
    const prompt = buildUserPrompt(baseEnv, [], [], { bundle: "x" }, false);
    expect(prompt).toContain("## Kubernetes Guidance");
    expect(prompt).toMatch(/operational pressure/);
    expect(prompt).toMatch(/do not invent counts/i);
  });

  it("user prompt adds container guidance when is_container is true", () => {
    const env: EnvironmentContext = { ...baseEnv, os: "Linux", is_container: true };
    const prompt = buildUserPrompt(env, [], [] as PreFinding[], { container: "y" }, false);
    expect(prompt).toContain("## Container Guidance");
  });

  it("user prompt adds incomplete-audit warning when flagged", () => {
    const prompt = buildUserPrompt(
      baseEnv,
      [] as NoiseItem[],
      [] as PreFinding[],
      {},
      true,
      "missing disk section"
    );
    expect(prompt).toContain("Incomplete Audit");
    expect(prompt).toContain("missing disk section");
  });
});
