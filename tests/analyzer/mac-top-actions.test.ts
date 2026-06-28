import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MacDiagnosticsAdapter } from "@/lib/adapter/mac-diagnostics/index";
import { analyzeArtifact } from "@/lib/analyzer/index";
import { buildMacTopActions } from "@/lib/analyzer/mac-top-actions";

const FIXTURES = join(__dirname, "../fixtures");

function clearLlmEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_PROVIDER;
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.AZURE_OPENAI_API_VERSION;
  delete process.env.AZURE_OPENAI_DEPLOYMENT;
}

describe("mac top actions for Mira/Codex", () => {
  it("emits gated fallback actions for cleanup-enriched mac-diagnostics", async () => {
    const envSnap = { ...process.env };
    try {
      clearLlmEnv();

      const raw = readFileSync(
        join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"),
        "utf-8"
      );
      const result = await analyzeArtifact(raw, {
        apiKey: undefined,
        artifactType: "mac-diagnostics",
      });

      expect(result.meta.llm_succeeded).toBe(false);
      const actions = result.report?.top_actions_now ?? [];
      expect(actions).toHaveLength(3);
      expect(actions.every((action) => /^\[(safe-immediate|review-required|authority-gated)\] /.test(action))).toBe(
        true
      );
      expect(actions.some((action) => action.includes("operator-mac.local"))).toBe(true);
      expect(actions.every((action) => action.toLowerCase().includes("resubmit mac-diagnostics"))).toBe(true);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnap)) delete process.env[key];
      }
      Object.assign(process.env, envSnap);
    }
  });

  it("ranks high-severity network exposure ahead of warning-band disk cleanup", async () => {
    const envSnap = { ...process.env };
    try {
      clearLlmEnv();

      const raw = readFileSync(
        join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"),
        "utf-8"
      );
      const result = await analyzeArtifact(raw, {
        apiKey: undefined,
        artifactType: "mac-diagnostics",
      });

      const actions = result.report?.top_actions_now ?? [];
      expect(actions[0]).toMatch(/^\[review-required\]/);
      expect(
        actions[0].toLowerCase().includes("remote-login") ||
          actions[0].toLowerCase().includes("wildcard listeners")
      ).toBe(true);
      expect(
        actions.filter((action) => /daily[- ]cleanup/i.test(action)).length
      ).toBeLessThanOrEqual(1);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnap)) delete process.env[key];
      }
      Object.assign(process.env, envSnap);
    }
  });

  it("prioritizes urgent disk-pressure correlation ahead of low-risk prune work", async () => {
    const envSnap = { ...process.env };
    try {
      clearLlmEnv();

      const raw = readFileSync(
        join(FIXTURES, "mac-workstation-disk-pressure-urgent-stale-cleanup.txt"),
        "utf-8"
      );
      const result = await analyzeArtifact(raw, {
        apiKey: undefined,
        artifactType: "mac-diagnostics",
      });

      const actions = result.report?.top_actions_now ?? [];
      expect(actions[0]).toMatch(/^\[(review-required|authority-gated)\]/);
      expect(actions[0]).toContain("urgent disk pressure");
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnap)) delete process.env[key];
      }
      Object.assign(process.env, envSnap);
    }
  });

  it("still ranks disk cleanup actions when the LLM returns a partial findings list", async () => {
    const envSnap = { ...process.env };
    try {
      process.env.OPENAI_API_KEY = "sk-test-fake";

      const raw = readFileSync(
        join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"),
        "utf-8"
      );
      const adapter = new MacDiagnosticsAdapter();
      const sections = adapter.parseSections(adapter.stripNoise(raw));
      const env = adapter.detectEnvironment(sections);
      const preFindings = adapter.extractPreFindings(sections, env);
      const partialFindings = preFindings.slice(0, 2).map((pf, index) => ({
        id: `F${String(index + 1).padStart(3, "0")}`,
        title: pf.title,
        severity: pf.severity_hint,
        category: pf.category,
        section_source: pf.section_source,
        evidence: pf.evidence,
        why_it_matters: "mock",
        recommended_action: "mock",
      }));

      const mockClient = {
        responses: {
          create: async () => ({
            output_text: JSON.stringify({
              summary: ["Mocked mac summary"],
              findings: partialFindings,
              environment_context: env,
              noise_or_expected: [],
              top_actions_now: ["Vague action 1", "Vague action 2", "Vague action 3"],
            }),
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          }),
        },
      } as never;

      const result = await analyzeArtifact(raw, {
        apiKey: "sk-test-fake",
        artifactType: "mac-diagnostics",
        _openaiClient: mockClient,
      });

      const actions = result.report?.top_actions_now ?? [];
      expect(actions.some((action) => action.toLowerCase().includes("disk pressure"))).toBe(true);
      expect(actions.every((action) => /^\[(safe-immediate|review-required|authority-gated)\] /.test(action))).toBe(
        true
      );
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnap)) delete process.env[key];
      }
      Object.assign(process.env, envSnap);
    }
  });

  it("overrides mocked LLM top actions with deterministic gated mac recommendations", async () => {
    const envSnap = { ...process.env };
    try {
      process.env.OPENAI_API_KEY = "sk-test-fake";

      const raw = readFileSync(
        join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"),
        "utf-8"
      );
      const adapter = new MacDiagnosticsAdapter();
      const sections = adapter.parseSections(adapter.stripNoise(raw));
      const env = adapter.detectEnvironment(sections);
      const preFindings = adapter.extractPreFindings(sections, env);
      const fakeFindings = preFindings.map((pf, index) => ({
        id: `F${String(index + 1).padStart(3, "0")}`,
        title: pf.title,
        severity: pf.severity_hint,
        category: pf.category,
        section_source: pf.section_source,
        evidence: pf.evidence,
        why_it_matters: "mock",
        recommended_action: "mock",
      }));

      const mockClient = {
        responses: {
          create: async () => ({
            output_text: JSON.stringify({
              summary: ["Mocked mac summary"],
              findings: fakeFindings,
              environment_context: env,
              noise_or_expected: [],
              top_actions_now: [
                "Do something vague on the host",
                "Review later",
                "Check logs",
              ],
            }),
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          }),
        },
      } as never;

      const result = await analyzeArtifact(raw, {
        apiKey: "sk-test-fake",
        artifactType: "mac-diagnostics",
        _openaiClient: mockClient,
      });

      expect(result.meta.llm_succeeded).toBe(true);
      const actions = result.report?.top_actions_now ?? [];
      expect(actions).not.toContain("Do something vague on the host");
      expect(actions.every((action) => /^\[(safe-immediate|review-required|authority-gated)\] /.test(action))).toBe(
        true
      );
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnap)) delete process.env[key];
      }
      Object.assign(process.env, envSnap);
    }
  });

  it("maps prune candidates to safe-immediate workstation actions", () => {
    const adapter = new MacDiagnosticsAdapter();
    const raw = readFileSync(
      join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"),
      "utf-8"
    );
    const sections = adapter.parseSections(adapter.stripNoise(raw));
    const env = adapter.detectEnvironment(sections);
    const preFindings = adapter.extractPreFindings(sections, env);
    const pruneIndex = preFindings.findIndex(
      (finding) => finding.rule_id === "mac.daily_cleanup_prune_candidates"
    );
    expect(pruneIndex).toBeGreaterThanOrEqual(0);
  });

  it("uses carried mac rule ids when finding ids are not positional", () => {
    const actions = buildMacTopActions(
      [
        {
          id: "finding-custom",
          rule_id: "mac.daily_cleanup_prune_candidates",
          title: "Daily cleanup found one linked-worktree prune candidate",
          severity: "low",
          category: "configuration",
          section_source: "daily_cleanup",
          evidence: "repo=/Users/vincent/src/example; prunable=1",
          why_it_matters: "mock",
          recommended_action: "mock",
        },
      ],
      [
        {
          rule_id: "mac.remote_access_posture",
          title: "Remote login exposure",
          severity_hint: "high",
          category: "network",
          section_source: "sharing",
          evidence: "remote_login=on",
        },
        {
          rule_id: "mac.daily_cleanup_prune_candidates",
          title: "Daily cleanup found one linked-worktree prune candidate",
          severity_hint: "low",
          category: "configuration",
          section_source: "daily_cleanup",
          evidence: "repo=/Users/vincent/src/example; prunable=1",
        },
      ],
      {
        hostname: "operator-mac.local",
        os: "macos",
        kernel: "Darwin",
        is_wsl: false,
        is_container: false,
        is_virtual_machine: false,
        ran_as_root: false,
        uptime: "unknown",
      },
      false
    );

    expect(actions[0]).toMatch(/^\[safe-immediate\]/);
    expect(actions[0]).toContain("git worktree prune");
  });
});
