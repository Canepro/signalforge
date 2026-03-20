import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { LinuxAuditLogAdapter } from "@/lib/adapter/linux-audit-log/index";
import { AnalysisResultSchema, AuditReportSchema } from "@/lib/analyzer/schema";

const FIXTURES = join(__dirname, "../fixtures");
const GOLDEN = join(__dirname, "../golden");

interface GoldenExpectation {
  environment: {
    is_wsl: boolean;
    ran_as_root: boolean;
    os_contains: string;
  };
  must_be_noise: string[];
  must_not_be_findings: string[];
  must_be_findings: Array<{
    title_contains: string;
    severity: string;
    category: string;
  }>;
  is_incomplete: boolean;
  min_findings: number;
  max_findings: number;
}

const FIXTURE_FILES = [
  { log: "sample-prod-server.log", golden: "sample-prod-server.expected.json" },
  { log: "wsl-nov2025-full.log", golden: "wsl-nov2025-full.expected.json" },
  { log: "wsl-nov2025-truncated.log", golden: "wsl-nov2025-truncated.expected.json" },
  { log: "wsl-mar2026-full.log", golden: "wsl-mar2026-full.expected.json" },
];

describe("Deterministic pipeline (golden-sample evaluation)", () => {
  const adapter = new LinuxAuditLogAdapter();

  for (const { log, golden } of FIXTURE_FILES) {
    describe(log, () => {
      const raw = readFileSync(join(FIXTURES, log), "utf-8");
      const expected: GoldenExpectation = JSON.parse(
        readFileSync(join(GOLDEN, golden), "utf-8")
      );

      const clean = adapter.stripNoise(raw);
      const sections = adapter.parseSections(clean);
      const env = adapter.detectEnvironment(sections);
      const noise = adapter.classifyNoise(sections, env);
      const preFindings = adapter.extractPreFindings(sections, env);
      const { incomplete } = adapter.detectIncomplete(sections);

      it("environment detection matches expected", () => {
        expect(env.is_wsl).toBe(expected.environment.is_wsl);
        expect(env.ran_as_root).toBe(expected.environment.ran_as_root);
        expect(env.os).toContain(expected.environment.os_contains);
      });

      it("incomplete detection matches expected", () => {
        expect(incomplete).toBe(expected.is_incomplete);
      });

      it("required noise items are classified", () => {
        const noiseObs = noise.map((n) => n.observation);
        for (const required of expected.must_be_noise) {
          expect(
            noiseObs.some((o) => o.includes(required)),
            `noise should contain: "${required}". Got: ${noiseObs.join(", ")}`
          ).toBe(true);
        }
      });

      it("noise items do not appear as findings", () => {
        const findingTitles = preFindings.map((f) => f.title);
        for (const forbidden of expected.must_not_be_findings) {
          expect(
            findingTitles.some((t) => t.includes(forbidden)),
            `finding should NOT contain: "${forbidden}"`
          ).toBe(false);
        }
      });

      it("required findings are present", () => {
        for (const req of expected.must_be_findings) {
          const match = preFindings.find(
            (f) =>
              f.title.toLowerCase().includes(req.title_contains.toLowerCase()) &&
              f.severity_hint === req.severity &&
              f.category === req.category
          );
          expect(
            match,
            `expected finding matching: ${JSON.stringify(req)}`
          ).toBeDefined();
        }
      });

      it("finding count within expected range", () => {
        expect(preFindings.length).toBeGreaterThanOrEqual(expected.min_findings);
        expect(preFindings.length).toBeLessThanOrEqual(expected.max_findings);
      });

      it("all findings have evidence", () => {
        for (const f of preFindings) {
          expect(f.evidence.length, `finding "${f.title}" lacks evidence`).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe("LLM fallback", () => {
  it("produces a valid fallback result without an API key", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-full.log"), "utf-8");

    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const result = await analyzeArtifact(raw, { apiKey: undefined });

      expect(result.meta.llm_succeeded).toBe(false);
      expect(result.analysis_error).toBeDefined();
      expect(result.report).not.toBeNull();
      expect(result.environment.is_wsl).toBe(true);
      expect(result.noise.length).toBeGreaterThan(0);

      if (result.report) {
        const parsed = AuditReportSchema.safeParse(result.report);
        expect(parsed.success).toBe(true);
      }
    } finally {
      if (oldKey) process.env.OPENAI_API_KEY = oldKey;
    }
  });
});
