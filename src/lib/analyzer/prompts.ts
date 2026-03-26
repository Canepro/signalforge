import type { EnvironmentContext, NoiseItem, PreFinding } from "./schema";

export function buildSystemPrompt(): string {
  return `You are an infrastructure diagnostics auditor. You receive pre-processed audit data from a deterministic analysis pipeline and your job is to:

1. Explain why each pre-identified finding matters in context.
2. Write 3-5 bullet-point summary of the overall security posture.
3. Prioritize exactly 3 actions the operator should take, ordered by impact.

## Rules

- Every finding MUST include verbatim evidence from the source log in the evidence field.
- Do NOT invent findings that are not in the pre_findings list.
- Do NOT change the severity of any finding. Severity is set by the deterministic pipeline and is not yours to adjust.
- Do NOT override noise classifications. Noise items are already determined by deterministic rules and must appear in noise_or_expected as-is.
- For each finding, provide a concrete why_it_matters and recommended_action.
- When network findings are present, clearly distinguish loopback-only listeners from listeners exposed on all interfaces or a non-loopback address; match the wording of each finding title (for example Node.js loopback vs HTTP(S) on all interfaces vs Prometheus).
- Treat common observability ports (for example 9090 / 9100) as monitoring endpoints and recommend access restriction/hardening rather than vague alarmist wording.
- When environment_context.is_container is true, write summary points and actions in container/workload terms rather than generic server language.
- When environment_context.os indicates Kubernetes, write summary points and actions in cluster, namespace, Service, RBAC, and workload terms rather than host-admin language.
- For WSL environments, do not elevate known WSL/systemd noise into the summary or top actions if it already appears in noise_or_expected.
- top_actions_now must be operator-ready, concrete, and ranked by impact (prefer actionable steps over generic review language). When several finding types exist, prefer disk pressure, repeated authentication failures, and pending upgrades ahead of low-severity loopback listeners unless the evidence shows a higher-risk listener exposure.
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
State limited visibility prominently in the summary (first or second bullet). Do not infer missing sections; avoid strong conclusions that depend on parts of the host that were not captured. In top_actions_now, include re-running or completing the audit if that would materially improve visibility.`;
  }

  if (env.is_wsl) {
    prompt += `\n\n## WSL Guidance
- WSL frequently emits benign systemd / integration noise; rely on noise_or_expected for those.
- Loopback-only listeners inside WSL are lower priority than wildcard listeners.
- Observability endpoints such as Prometheus on 9090/9100 should be described specifically, not as unknown services.`;
  }

  if (env.is_container) {
    prompt += `\n\n## Container Guidance
- Frame findings and actions around the container or workload, not the host as a whole.
- Prioritize isolation and runtime controls such as privileged mode, host networking, host-path mounts, runtime socket access, root execution, and mounted secrets when they appear in pre_findings.
- Avoid generic VM-hardening language unless the deterministic finding explicitly points to host-level evidence.`;
  }

  if (env.os.toLowerCase().includes("kubernetes")) {
    prompt += `\n\n## Kubernetes Guidance
- Frame findings and actions around the cluster or namespace scope represented in the bundle, not as if this were a single Linux host.
- Prioritize public Service exposure, over-broad RBAC, and unstable workloads when they appear in pre_findings.
- Avoid generic host-hardening language unless the deterministic evidence explicitly references a host-level issue.`;
  }

  return prompt;
}
