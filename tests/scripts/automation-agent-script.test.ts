import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

describe("scripts/signalforge-automation-agent.sh", () => {
  const script = join(__dirname, "../../scripts/signalforge-automation-agent.sh");

  it("parses as valid bash", () => {
    expect(() => {
      execSync(`bash -n "${script}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("prints help with --help", () => {
    const out = execSync(`bash "${script}" --help`, { encoding: "utf8" });
    expect(out).toContain("register <source-id>");
    expect(out).toContain("POST /api/automation-agent/registrations");
    expect(out).toContain("POST /api/automation-agent/diagnostic-requests");
    expect(out).toContain("SIGNALFORGE_AUTOMATION_AGENT_TOKEN");
    expect(out).toContain("--print-exports");
    expect(out).toContain("automation-agent-integration.md");
  });

  it("keeps stdout machine-readable and emits exports separately", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain('PRINT_EXPORTS="false"');
    expect(src).toContain('--print-exports');
    expect(src).toContain('printf \'%s\\n\' "$resp"');
    expect(src).toContain('echo "export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=${token}" >&2');
  });

  it("maps commands to automation-agent API paths", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("/api/automation-agent/registrations");
    expect(src).toContain("/api/automation-agent/diagnostic-requests");
    expect(src).toContain("submitted|failed|cancelled|expired");
  });
});
