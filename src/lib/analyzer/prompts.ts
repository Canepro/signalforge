import type { EnvironmentContext, NoiseItem, PreFinding } from "./schema.js";

export function buildSystemPrompt(): string {
  return `You are a server security auditor. You receive pre-processed audit data from a deterministic analysis pipeline and your job is to:

1. Explain why each pre-identified finding matters in context.
2. Write 3-5 bullet-point summary of the overall security posture.
3. Prioritize exactly 3 actions the operator should take, ordered by impact.

## Rules

- Every finding MUST include verbatim evidence from the source log in the evidence field.
- Do NOT invent findings that are not in the pre_findings list.
- Do NOT change the severity of any finding. Severity is set by the deterministic pipeline and is not yours to adjust.
- Do NOT override noise classifications. Noise items are already determined by deterministic rules and must appear in noise_or_expected as-is.
- For each finding, provide a concrete why_it_matters and recommended_action.
- Finding IDs must match the pre_findings list (F001, F002, etc. in order).
- top_actions_now must have exactly 3 items. No more, no fewer.`;
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
