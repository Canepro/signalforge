import type { EnvironmentContext, NoiseItem, PreFinding } from "./schema.js";

export function buildSystemPrompt(): string {
  return `You are a server security auditor. You receive pre-processed audit data from a deterministic analysis pipeline and your job is to:

1. Explain why each pre-identified finding matters in context.
2. Write 3-5 bullet-point summary of the overall security posture.
3. Prioritize exactly 3 actions the operator should take, ordered by impact.
4. Optionally adjust severity if environment context changes the meaning (with justification).

## Severity Rubric

- critical: Active compromise indicators (unauthorized users, unexpected public-facing services, tampered binaries, rootkit signatures).
- high: Exposed services with failed auth spikes, unpatched critical CVEs, missing firewall on public-facing ports, unauthorized SSH keys.
- medium: Misconfigurations, risky defaults (PermitRootLogin yes), stale users with shell access, disk usage above 85%, outdated packages.
- low: Expected limitations, informational items, non-root visibility gaps, minor housekeeping.

## Rules

- Every finding MUST include verbatim evidence from the source log in the evidence field.
- Do NOT invent findings that are not in the pre_findings list.
- Do NOT override noise classifications. Noise items are already determined by deterministic rules and must appear in noise_or_expected as-is.
- For each finding, provide a concrete why_it_matters and recommended_action.
- Finding IDs should be sequential: F001, F002, etc.
- top_actions_now must have exactly 3 items.`;
}

export function buildUserPrompt(
  env: EnvironmentContext,
  noise: NoiseItem[],
  preFindings: PreFinding[],
  sections: Record<string, string>,
  isIncomplete: boolean,
  incompleteReason?: string
): string {
  const sectionSummary = Object.entries(sections)
    .map(([name, content]) => {
      const lineCount = content.split("\n").length;
      const preview = content.split("\n").slice(0, 5).join("\n");
      return `### ${name} (${lineCount} lines)\n${preview}\n...`;
    })
    .join("\n\n");

  let prompt = `## Environment Context
${JSON.stringify(env, null, 2)}

## Pre-identified Noise (deterministic, do not override)
${JSON.stringify(noise, null, 2)}

## Pre-identified Findings (deterministic, explain and prioritize these)
${JSON.stringify(preFindings, null, 2)}

## Audit Log Sections
${sectionSummary}`;

  if (isIncomplete) {
    prompt += `\n\n## WARNING: Incomplete Audit
This audit log is incomplete: ${incompleteReason}
Include a note about limited visibility in the summary.`;
  }

  return prompt;
}
