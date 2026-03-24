import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

describe("scripts/signalforge-read.sh", () => {
  const script = join(__dirname, "../../scripts/signalforge-read.sh");

  it("parses as valid bash", () => {
    expect(() => {
      execSync(`bash -n "${script}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("prints help with --help", () => {
    const out = execSync(`bash "${script}" --help`, { encoding: "utf8" });
    expect(out).toContain("run <run-id>");
    expect(out).toContain("compare");
    expect(out).toContain("SIGNALFORGE_URL");
    expect(out).toContain("analyze.sh");
  });

  it("maps commands to GET API paths", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toMatch(/api\/runs\/\$\{RUN_ID\}/);
    expect(src).toContain("${URL}/report");
    expect(src).toContain("compare");
    expect(src).toContain("?against=");
  });

  it("prints HTTP status to stderr on non-200", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("signalforge-read: HTTP");
    expect(src).toContain(">&2");
  });
});
