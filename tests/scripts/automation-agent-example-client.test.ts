import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

describe("examples/automation_agent_client.py", () => {
  const script = join(__dirname, "../../examples/automation_agent_client.py");

  it("parses as valid Python", () => {
    expect(() => {
      execSync(`python3 -m py_compile "${script}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("documents the automation-agent flow", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("/api/automation-agent/diagnostic-requests");
    expect(src).toContain("SIGNALFORGE_AUTOMATION_AGENT_TOKEN");
    expect(src).toContain("--summary-only");
    expect(src).toContain("external automation");
    expect(src).toContain("OpenClaw/Hermes-style");
  });
});
