import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveSqlJsDistDir } from "@/lib/db/client";

describe("resolveSqlJsDistDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "signalforge-sqljs-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prefers the standalone traced sql.js dist path when present", () => {
    const standaloneDist = join(tempDir, ".next", "standalone", "node_modules", "sql.js", "dist");
    mkdirSync(standaloneDist, { recursive: true });

    expect(resolveSqlJsDistDir(tempDir)).toBe(standaloneDist);
  });

  it("falls back to the default node_modules sql.js dist path when no traced copy exists", () => {
    expect(resolveSqlJsDistDir(tempDir)).toBe(join(tempDir, "node_modules", "sql.js", "dist"));
  });
});
