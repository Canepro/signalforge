import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

describe("examples/recommendation_handoff.py", () => {
  const script = join(__dirname, "../../examples/recommendation_handoff.py");
  const fixture = join(__dirname, "../fixtures/automation-agent-summary-sample.json");

  it("parses as valid Python", () => {
    expect(() => {
      execSync(`python3 -m py_compile "${script}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("documents a recommendation-only boundary", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("recommendation_only");
    expect(src).toContain("execution_allowed");
    expect(src).toContain("remediation_allowed");
    expect(src).toContain("automation_agent_client.py");
    expect(src).toContain("--prompt-only");
    expect(src).toContain("build_recommendation_handoff");
    expect(src).toContain("OpenClaw/Hermes-style");
  });

  it("builds a prompt from the checked-in sample summary fixture", () => {
    const out = execSync(
      `python3 "${script}" --summary-file "${fixture}" --prompt-only`,
      { encoding: "utf8" }
    );
    expect(out).toContain("User goal:");
    expect(out).toContain("sample-request-id");
    expect(out).toContain("sample-prod-server");
    expect(out).toContain("Recommendation only");
    expect(out).toContain("No command execution");
  });
});
