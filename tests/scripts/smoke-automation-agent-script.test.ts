import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

describe("scripts/smoke-automation-agent-local.sh", () => {
  const script = join(__dirname, "../../scripts/smoke-automation-agent-local.sh");

  it("parses as valid bash", () => {
    expect(() => {
      execSync(`bash -n "${script}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("prints help with --help", () => {
    const out = execSync(`bash "${script}" --help`, { encoding: "utf8" });
    expect(out).toContain("automation-agent");
    expect(out).toContain("execution-agent");
    expect(out).toContain("--url");
    expect(out).toContain("sample-prod-server.log");
    expect(out).toContain("source_id");
    expect(out).toContain("run_id");
  });

  it("documents the real route flow and package entrypoint", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("signalforge-automation-agent.sh");
    expect(src).toContain("request_id");
    expect(src).toContain("/api/agent/heartbeat");
    expect(src).toContain("/api/agent/jobs/next");
    expect(src).toContain("/api/collection-jobs/${JOB_ID}/artifact");
    expect(src).toContain("artifact_run_status");
  });
});
