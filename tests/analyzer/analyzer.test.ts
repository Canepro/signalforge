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
        expect(result.report.top_actions_now).toHaveLength(3);
      }
    } finally {
      if (oldKey) process.env.OPENAI_API_KEY = oldKey;
    }
  });

  it("fallback always returns exactly 3 top_actions_now even with few findings", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    const raw = readFileSync(join(FIXTURES, "wsl-nov2025-truncated.log"), "utf-8");

    const result = await analyzeArtifact(raw, { apiKey: undefined });
    expect(result.report).not.toBeNull();
    expect(result.report!.top_actions_now).toHaveLength(3);
  });
});

describe("LLM success path (mocked)", () => {
  it("preserves deterministic severity, merges env/noise, reports tokens", async () => {
    const { analyzeArtifact } = await import("@/lib/analyzer/index");
    const raw = readFileSync(join(FIXTURES, "wsl-mar2026-full.log"), "utf-8");
    const adapter = new LinuxAuditLogAdapter();

    const clean = adapter.stripNoise(raw);
    const sections = adapter.parseSections(clean);
    const env = adapter.detectEnvironment(sections);
    const noise = adapter.classifyNoise(sections, env);
    const preFindings = adapter.extractPreFindings(sections, env);

    const fakeLlmFindings = preFindings.map((pf, i) => ({
      id: `F${String(i + 1).padStart(3, "0")}`,
      title: pf.title,
      severity: "critical" as const,
      category: pf.category,
      section_source: pf.section_source,
      evidence: pf.evidence,
      why_it_matters: "Mocked explanation for " + pf.title,
      recommended_action: "Mocked action for " + pf.title,
    }));

    const fakeLlmReport = {
      summary: ["Mocked summary bullet 1", "Mocked summary bullet 2", "Mocked summary bullet 3"],
      findings: fakeLlmFindings,
      environment_context: env,
      noise_or_expected: noise,
      top_actions_now: ["Action A", "Action B", "Action C"],
    };

    const mockClient = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify(fakeLlmReport),
          usage: { input_tokens: 1200, output_tokens: 800, total_tokens: 2000 },
        }),
      },
    } as never;

    const result = await analyzeArtifact(raw, {
      apiKey: "sk-test-fake",
      _openaiClient: mockClient,
    });

    expect(result.meta.llm_succeeded).toBe(true);
    expect(result.meta.tokens_used).toBe(2000);

    expect(result.report).not.toBeNull();
    const report = result.report!;

    expect(report.top_actions_now).toHaveLength(3);

    expect(report.environment_context.is_wsl).toBe(true);
    expect(report.environment_context).toEqual(env);

    expect(report.noise_or_expected.length).toBe(noise.length);

    for (let i = 0; i < report.findings.length; i++) {
      const finding = report.findings[i];
      const preFinding = preFindings[i];
      if (preFinding) {
        expect(finding.severity).toBe(preFinding.severity_hint);
        expect(finding.severity).not.toBe("critical");
      }
    }

    expect(report.findings[0]?.why_it_matters).toContain("Mocked explanation");
  });
});
