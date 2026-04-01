import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

describe("scripts/analyze.sh", () => {
  const script = join(__dirname, "../../scripts/analyze.sh");

  it("parses as valid bash", () => {
    expect(() => {
      execSync(`bash -n "${script}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("prints help with --help", () => {
    const out = execSync(`bash "${script}" --help`, { encoding: "utf8" });
    expect(out).toContain("--artifact-type");
    expect(out).toContain("SIGNALFORGE_ARTIFACT_TYPE");
    expect(out).toContain("--target-id");
    expect(out).toContain("SIGNALFORGE_TARGET_IDENTIFIER");
    expect(out).toContain("external-submit.md");
    expect(out).toContain("signalforge-read.sh");
  });

  it("maps CLI flags to multipart field names used by POST /api/runs", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toMatch(/artifact_type/);
    expect(src).toMatch(/target_identifier/);
    expect(src).toMatch(/source_label/);
    expect(src).toMatch(/collector_type/);
    expect(src).toMatch(/collector_version/);
    expect(src).toMatch(/collected_at/);
    expect(src).toContain('--artifact-type');
    expect(src).toContain('--target-id');
    expect(src).toContain('--source-label');
    expect(src).toContain('--collector-type');
    expect(src).toContain('--collector-version');
    expect(src).toContain('--collected-at');
  });

  it("prints compare and read helper lines after submit", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("compare_ui:");
    expect(src).toContain("compare_api:");
    expect(src).toContain("read_compare:");
    expect(src).toContain("signalforge-read.sh");
  });
});
