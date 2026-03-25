import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses.js";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { getAdapter, detectArtifactType } from "../adapter/registry";
import {
  AuditReportSchema,
  type AnalysisResult,
  type AuditReport,
  type EnvironmentContext,
  type Finding,
  type NoiseItem,
  type PreFinding,
} from "./schema";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { createOpenAIClient, resolveLlmConfig } from "./llm-provider";
import { auditReportResponseFormat } from "./response-format";

export interface AnalyzeOptions {
  apiKey?: string;
  model?: string;
  artifactType?: string;
  /** @internal test-only: inject an OpenAI SDK–compatible client (OpenAI or Azure-shaped base URL). */
  _openaiClient?: OpenAI;
}

function displayModelForMeta(options: AnalyzeOptions): string {
  return (
    options.model?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ||
    "gpt-5-mini"
  );
}

export async function analyzeArtifact(
  content: string,
  options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const artifactType = options.artifactType ?? detectArtifactType(content);
  const adapter = getAdapter(artifactType);

  const clean = adapter.stripNoise(content);
  const sections = adapter.parseSections(clean);
  const env = adapter.detectEnvironment(sections);
  const noise = adapter.classifyNoise(sections, env);
  const preFindings = adapter.extractPreFindings(sections, env);
  const { incomplete, reason } = adapter.detectIncomplete(sections);

  const startMs = Date.now();
  const metaModel = displayModelForMeta(options);

  let client: OpenAI;
  let model: string;

  if (options._openaiClient) {
    client = options._openaiClient;
    model = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  } else {
    const resolved = resolveLlmConfig(process.env, {
      apiKey: options.apiKey,
      model: options.model,
    });
    if (!resolved.ready) {
      return buildFallbackResult(
        env,
        noise,
        preFindings,
        incomplete,
        reason,
        metaModel,
        startMs,
        resolved.reason
      );
    }
    client = createOpenAIClient(resolved);
    model = resolved.model;
  }

  try {
    const { report: llmReport, tokensUsed } = await callLlm(
      client,
      model,
      env,
      noise,
      preFindings,
      sections,
      incomplete,
      reason
    );
    const duration = Date.now() - startMs;

    const reconciledFindings = reconcileSeverity(llmReport.findings, preFindings);

    const mergedReport: AuditReport = {
      summary: llmReport.summary,
      findings: reconciledFindings,
      environment_context: env,
      noise_or_expected: noise,
      top_actions_now: llmReport.top_actions_now,
    };

    return {
      report: mergedReport,
      environment: env,
      noise,
      pre_findings: preFindings,
      is_incomplete: incomplete,
      incomplete_reason: reason,
      meta: {
        model_used: model,
        tokens_used: tokensUsed,
        duration_ms: duration,
        llm_succeeded: true,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildFallbackResult(env, noise, preFindings, incomplete, reason, model, startMs, message);
  }
}

function buildFallbackResult(
  env: EnvironmentContext,
  noise: NoiseItem[],
  preFindings: PreFinding[],
  incomplete: boolean,
  incompleteReason: string | undefined,
  model: string,
  startMs: number,
  error: string
): AnalysisResult {
  const fallbackFindings = preFindings.map((pf, i) => ({
    id: `F${String(i + 1).padStart(3, "0")}`,
    title: pf.title,
    severity: pf.severity_hint,
    category: pf.category,
    section_source: pf.section_source,
    evidence: pf.evidence,
    why_it_matters: "(LLM explanation unavailable)",
    recommended_action: "(LLM recommendation unavailable)",
  }));

  const summary = buildFallbackSummary(
    fallbackFindings,
    env,
    noise,
    incomplete,
    incompleteReason,
    error
  );
  const topActions = buildFallbackActions(fallbackFindings, env, incomplete);

  return {
    report: {
      summary,
      findings: fallbackFindings,
      environment_context: env,
      noise_or_expected: noise,
      top_actions_now: topActions,
    },
    environment: env,
    noise,
    pre_findings: preFindings,
    is_incomplete: incomplete,
    incomplete_reason: incompleteReason,
    analysis_error: error,
    meta: {
      model_used: model,
      tokens_used: 0,
      duration_ms: Date.now() - startMs,
      llm_succeeded: false,
    },
  };
}

function reconcileSeverity(llmFindings: Finding[], preFindings: PreFinding[]): Finding[] {
  return llmFindings.map((f) => {
    const matchByTitle = preFindings.find(
      (pf) =>
        f.title.toLowerCase().includes(pf.title.toLowerCase()) ||
        pf.title.toLowerCase().includes(f.title.toLowerCase())
    );
    const matchById = preFindings[parseInt(f.id.replace(/\D/g, ""), 10) - 1];
    const match = matchByTitle ?? matchById;

    if (match) {
      return { ...f, severity: match.severity_hint };
    }
    return f;
  });
}

const FILLER_ACTIONS = [
  "Review the full findings table and address items by severity",
  "Rerun the audit with elevated privileges if visibility was limited",
  "Collect a fresh full audit to establish a current baseline",
];

function severityWeight(severity: Finding["severity"]): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

/** When severities tie, prefer categories that usually need action first (disk/auth before loopback listeners). */
const CATEGORY_TIE_BREAK: Record<string, number> = {
  disk: 6,
  auth: 5,
  kubernetes: 5,
  packages: 4,
  ssh: 3,
  network: 2,
  logs: 1,
};

function containerTitlePriority(title: string): number {
  const normalized = title.toLowerCase();
  if (normalized.includes("docker socket")) return 6;
  if (normalized.includes("privileged mode")) return 5;
  if (normalized.includes("host network")) return 4;
  if (normalized.includes("host pid namespace")) return 3;
  if (normalized.includes("root filesystem is not read-only")) return 2;
  if (normalized.includes("privilege escalation")) return 1;
  return 0;
}

function kubernetesTitlePriority(title: string): number {
  const normalized = title.toLowerCase();
  if (normalized.includes("service account is bound to cluster-admin")) return 11;
  if (normalized.includes("cluster-admin binding")) return 10;
  if (normalized.includes("grants privilege-escalation verbs")) return 9;
  if (normalized.includes("node proxy apis")) return 8;
  if (normalized.includes("grants wildcard access")) return 7;
  if (normalized.includes("shares the host network namespace")) return 6;
  if (normalized.includes("shares the host pid namespace")) return 6;
  if (normalized.includes("shares the host ipc namespace")) return 6;
  if (normalized.includes("mounts hostpath volumes")) return 6;
  if (normalized.includes("uses privileged init containers")) return 6;
  if (normalized.includes("without networkpolicy isolation")) return 5;
  if (normalized.includes("service exposed externally")) return 4;
  if (normalized.includes("uses the default service account with token automount")) return 3;
  if (normalized.includes("automatically mounts service account tokens")) return 2;
  if (normalized.includes("bulk-imports secret data into environment variables")) return 1;
  if (normalized.includes("injects secret values into environment variables")) return 1;
  if (normalized.includes("mounts projected service account token volumes")) return 1;
  return 0;
}

function compareFindingsForFallback(a: Finding, b: Finding): number {
  const bySev = severityWeight(b.severity) - severityWeight(a.severity);
  if (bySev !== 0) return bySev;
  const byContainerTitle =
    (b.category === "container" ? containerTitlePriority(b.title) : 0) -
    (a.category === "container" ? containerTitlePriority(a.title) : 0);
  if (byContainerTitle !== 0) return byContainerTitle;
  const byKubernetesTitle =
    (b.category === "kubernetes" ? kubernetesTitlePriority(b.title) : 0) -
    (a.category === "kubernetes" ? kubernetesTitlePriority(a.title) : 0);
  if (byKubernetesTitle !== 0) return byKubernetesTitle;
  return (CATEGORY_TIE_BREAK[b.category] ?? 0) - (CATEGORY_TIE_BREAK[a.category] ?? 0);
}

function summarizeFallbackFinding(finding: Finding): string {
  if (finding.category === "disk") {
    return `${finding.title}, which leaves limited headroom for writes or package operations.`;
  }
  if (finding.category === "packages") {
    return `${finding.title}, so operating system updates remain unapplied.`;
  }
  if (finding.category === "network") {
    const t = finding.title.toLowerCase();
    if (t.includes("loopback only") || t.includes("not reachable remotely")) {
      return `${finding.title}; local-only — confirm it is expected tooling, not accidental exposure elsewhere.`;
    }
    if (t.includes("reachable on all network interfaces") || t.includes("exposed on all interfaces")) {
      return `${finding.title}; review bind address and host firewall if broad reachability is not intended.`;
    }
    return `${finding.title}, which should be reviewed to confirm the exposure matches intent.`;
  }
  if (finding.category === "logs") {
    return `${finding.title}, indicating recent service or platform errors still warrant review after noise filtering.`;
  }
  if (finding.category === "container") {
    const title = finding.title.toLowerCase();
    if (title.includes("privileged mode")) {
      return `${finding.title}, which gives the workload elevated access to host resources and weakens isolation.`;
    }
    if (title.includes("host network")) {
      return `${finding.title}, which bypasses normal container network isolation and broadens blast radius.`;
    }
    if (title.includes("host pid namespace")) {
      return `${finding.title}, which lets the workload see or interact with host processes beyond normal container isolation.`;
    }
    if (title.includes("docker socket")) {
      return `${finding.title}, which can allow the workload to control other containers or the host runtime.`;
    }
    if (title.includes("linux capabilities")) {
      return `${finding.title}, which expands the workload's privilege surface beyond a default container profile.`;
    }
    if (title.includes("privilege escalation")) {
      return `${finding.title}, which weakens the guardrails that normally limit process privilege growth inside the workload.`;
    }
    if (title.includes("host-path mounts")) {
      return `${finding.title}, which may expose sensitive host data or permit unintended writes.`;
    }
    if (title.includes("mounted secrets")) {
      return `${finding.title}, so secret scope and file exposure should be reviewed for this workload.`;
    }
    if (title.includes("runs as root")) {
      return `${finding.title}, which increases the impact of a compromise inside the container.`;
    }
    if (title.includes("root filesystem is not read-only")) {
      return `${finding.title}, which makes post-compromise tampering and unexpected state changes easier inside the workload.`;
    }
    if (title.includes("not pinned")) {
      return `${finding.title}, which makes rollbacks and provenance harder to control over time.`;
    }
  }
  if (finding.category === "kubernetes") {
    const title = finding.title.toLowerCase();
    if (title.includes("service exposed externally")) {
      return `${finding.title}, which may expose the workload beyond the intended cluster or namespace boundary.`;
    }
    if (title.includes("without networkpolicy isolation")) {
      return `${finding.title}, so east-west and ingress traffic boundaries may be weaker than intended for an externally reachable namespace.`;
    }
    if (title.includes("cluster-admin binding")) {
      return `${finding.title}, which grants broad control over cluster resources and should be tightly limited.`;
    }
    if (title.includes("service account is bound to cluster-admin")) {
      return `${finding.title}, which means this specific workload identity can act with cluster-admin privileges if its pod credential is used or exposed.`;
    }
    if (title.includes("grants privilege-escalation verbs")) {
      return `${finding.title}, which can let a principal hand out or assume broader RBAC than intended.`;
    }
    if (title.includes("node proxy apis")) {
      return `${finding.title}, which can open a path to kubelet-level access that bypasses weaker workload boundaries.`;
    }
    if (title.includes("grants wildcard access")) {
      return `${finding.title}, which makes least-privilege review much harder and can silently widen access as the cluster evolves.`;
    }
    if (title.includes("crashloopbackoff")) {
      return `${finding.title}, indicating the workload is failing to stay healthy and may be degraded for operators or callers.`;
    }
    if (title.includes("runs privileged")) {
      return `${finding.title}, which weakens workload isolation and raises the blast radius of a compromise.`;
    }
    if (title.includes("allows privilege escalation")) {
      return `${finding.title}, which reduces the process-level guardrails expected in a hardened workload.`;
    }
    if (title.includes("automatically mounts service account tokens")) {
      return `${finding.title}, which increases the chance that in-cluster credentials are exposed to pods that do not actually need them.`;
    }
    if (title.includes("uses the default service account with token automount")) {
      return `${finding.title}, which increases the chance that broad namespace-default identity is available inside a pod without a workload-specific review.`;
    }
    if (title.includes("injects secret values into environment variables")) {
      return `${finding.title}, which can make credential exposure easier through process env dumps, crash output, or debugging workflows.`;
    }
    if (title.includes("bulk-imports secret data into environment variables")) {
      return `${finding.title}, which widens credential exposure because an entire Secret is loaded into the process environment instead of only the required keys.`;
    }
    if (title.includes("mounts secret volumes")) {
      return `${finding.title}, which broadens credential exposure on disk inside the pod and should be narrowed to only the mounts the workload truly needs.`;
    }
    if (title.includes("mounts projected service account token volumes")) {
      return `${finding.title}, which places Kubernetes API credentials directly on disk inside the pod and should be justified against the workload's actual API needs.`;
    }
    if (title.includes("shares the host network namespace")) {
      return `${finding.title}, which bypasses normal pod network isolation and can expose host-level interfaces or routing paths to the workload.`;
    }
    if (title.includes("shares the host pid namespace")) {
      return `${finding.title}, which gives the workload visibility into host-level processes and weakens isolation boundaries.`;
    }
    if (title.includes("shares the host ipc namespace")) {
      return `${finding.title}, which exposes host IPC resources to the pod and should be reserved for tightly reviewed exceptions.`;
    }
    if (title.includes("mounts hostpath volumes")) {
      return `${finding.title}, which can expose node-local filesystems to the pod and turn a workload issue into host-level data exposure.`;
    }
    if (title.includes("adds linux capabilities")) {
      return `${finding.title}, which widens the pod's effective privilege surface beyond a default least-privilege profile.`;
    }
    if (title.includes("uses privileged init containers")) {
      return `${finding.title}, which means the workload starts with elevated node-facing privileges even before the main container becomes ready.`;
    }
    if (title.includes("writable root filesystem")) {
      return `${finding.title}, which weakens immutable workload assumptions and makes tampering or persistence inside the pod easier.`;
    }
    if (title.includes("writable mounted volumes")) {
      return `${finding.title}, which can make persistence, tampering, or unexpected state carry-over easier if the container is compromised.`;
    }
    if (title.includes("runasnonroot")) {
      return `${finding.title}, so the workload may still execute as root unless the image and pod settings are tightened together.`;
    }
    if (title.includes("seccomp profile")) {
      return `${finding.title}, which leaves the workload without a tighter syscall baseline such as RuntimeDefault.`;
    }
    if (title.includes("missing liveness or readiness probes")) {
      return `${finding.title}, so Kubernetes may not detect failed or unready containers quickly enough.`;
    }
    if (title.includes("missing resource requests or limits")) {
      return `${finding.title}, which makes scheduling fairness and noisy-neighbor control harder to enforce.`;
    }
  }
  return `${finding.title}.`;
}

function buildFallbackSummary(
  findings: Finding[],
  env: EnvironmentContext,
  noise: NoiseItem[],
  incomplete: boolean,
  incompleteReason: string | undefined,
  error: string
): string[] {
  const summary = [
    `Deterministic analysis completed (LLM unavailable: ${error})`,
    `Environment: ${env.hostname} / ${env.os}${env.is_wsl ? " (WSL)" : ""}${env.is_container ? " (container)" : ""}`,
  ];

  if (incomplete) {
    summary.push(`Limited visibility: ${incompleteReason}`);
  }

  if (findings.length === 0) {
    summary.push(
      `No deterministic findings were raised; ${noise.length} expected noise item(s) were suppressed`
    );
  } else {
    const highSignal = findings
      .slice()
      .sort(compareFindingsForFallback)
      .slice(0, 2)
      .map((f) => summarizeFallbackFinding(f));
    summary.push(...highSignal);
    summary.push(
      `${findings.length} finding(s) detected, ${noise.length} noise item(s) suppressed`
    );
  }

  return summary;
}

function buildActionForFinding(
  finding: Finding,
  env: EnvironmentContext
): string {
  if (finding.category === "disk") {
    const mount = finding.title.match(/: (.+?) at \d+%/)?.[1] ?? "the affected volume";
    return `Free space on ${mount} or expand the backing volume so usage drops below the warning threshold before writes start failing.`;
  }

  if (finding.category === "packages") {
    const count = finding.title.match(/^(\d+)/)?.[1];
    return `Run \`sudo apt update && sudo apt upgrade\` to apply${count ? ` the ${count} pending` : ""} package updates, then reboot if core packages change.`;
  }

  if (finding.category === "network") {
    const port = finding.title.match(/port (\d+)/)?.[1];
    const tl = finding.title.toLowerCase();
    if (tl.includes("loopback only") || tl.includes("not reachable remotely")) {
      if (tl.includes("node.js")) {
        return `Confirm the Node.js loopback listener${port ? ` on port ${port}` : ""} is expected (dev server or local tooling); stop it or change the bind if not.`;
      }
      return `Confirm the loopback-only listener${port ? ` on port ${port}` : ""} is expected local tooling, and stop it if it is no longer needed.`;
    }
    if (tl.includes("prometheus")) {
      return `Restrict the observability endpoint${port ? ` on port ${port}` : ""} to loopback, VPN, or a firewall allowlist so monitoring data is not broadly exposed.`;
    }
    if (tl.includes("http listener (web)") || tl.includes("https listener (tls)")) {
      return `If this HTTP(S) service should not be reachable from the network, restrict it with a host firewall, bind address, or front it with a reverse proxy you control.`;
    }
    if (tl.includes("reachable on all network interfaces") || tl.includes("exposed on all interfaces")) {
      return `Review why the service${port ? ` on port ${port}` : ""} is reachable on all interfaces and tighten its bind address or firewall rules if that reachability is not required.`;
    }
    if (tl.includes("unidentified listener")) {
      return `Identify the process for port ${port ?? "?"} (for example \`ss -ltnp\` / \`sudo lsof -i -P -n\`) and restrict or stop it if remote access is not intended.`;
    }
    return `Review the listener${port ? ` on port ${port}` : ""} and confirm the bound address is intentionally reachable.`;
  }

  if (finding.category === "ssh") {
    return "Harden the SSH configuration by disabling risky settings unless there is a documented operational need for them.";
  }

  if (finding.category === "auth") {
    return "Investigate the repeated authentication failures, verify whether they are expected, and block or rate-limit the source if they are not.";
  }

  if (finding.category === "logs") {
    return env.is_wsl
      ? "Review the remaining recent log errors after WSL noise filtering and fix any service failures that are still actionable."
      : "Review the remaining recent log errors and investigate the service failures that generated them.";
  }

  if (finding.category === "container") {
    const tl = finding.title.toLowerCase();
    if (tl.includes("privileged mode")) {
      return "Drop privileged mode unless the workload has a documented hard requirement for it, and remove any unnecessary elevated capabilities.";
    }
    if (tl.includes("host network")) {
      return "Move the workload off host networking unless it is explicitly required, and re-check which ports need to stay reachable.";
    }
    if (tl.includes("host pid namespace")) {
      return "Disable host PID namespace sharing unless this workload has a documented debugging or runtime need for host-level process visibility.";
    }
    if (tl.includes("docker socket")) {
      return "Remove the Docker socket mount or replace it with a narrower runtime integration so the workload cannot control the host runtime.";
    }
    if (tl.includes("linux capabilities")) {
      return "Drop any added Linux capabilities that are not strictly required by the workload, and keep the runtime profile as close to default as possible.";
    }
    if (tl.includes("privilege escalation")) {
      return "Set the workload to block privilege escalation unless there is a documented need for it, and verify the container still runs with the reduced privilege model.";
    }
    if (tl.includes("host-path mounts")) {
      return "Review each host-path mount, narrow it to the minimum required path, and make it read-only where possible.";
    }
    if (tl.includes("mounted secrets")) {
      return "Review which secrets are mounted into the container and scope them down to only the files and workloads that need them.";
    }
    if (tl.includes("runs as root")) {
      return "Run the container as a non-root user where possible, and document the cases that still require root inside the workload.";
    }
    if (tl.includes("root filesystem is not read-only")) {
      return "Set the container root filesystem to read-only where possible, then move the small set of writable paths onto explicit writable volumes.";
    }
    if (tl.includes("not pinned")) {
      return "Pin the image to an immutable version or digest so deploys and rollback behavior stay predictable.";
    }
  }

  if (finding.category === "kubernetes") {
    const tl = finding.title.toLowerCase();
    if (tl.includes("service exposed externally")) {
      return "Review whether the LoadBalancer service truly needs public reachability, and switch it to ClusterIP or an internal load balancer if broad exposure is not required.";
    }
    if (tl.includes("without networkpolicy isolation")) {
      return "Add namespace-appropriate NetworkPolicy rules before treating the externally reachable workload as isolated, and verify ingress and egress are limited to the intended paths.";
    }
    if (tl.includes("cluster-admin binding")) {
      return "Remove the cluster-admin binding or replace it with the narrowest RBAC role that still meets the workload or operator need.";
    }
    if (tl.includes("service account is bound to cluster-admin")) {
      return "Move this workload onto a narrower service account and remove the cluster-admin grant so the pod identity only has the Kubernetes permissions it actually needs.";
    }
    if (tl.includes("grants privilege-escalation verbs")) {
      return "Remove bind, escalate, or impersonate from the RBAC role unless a tightly controlled break-glass path truly requires them, and document any exception.";
    }
    if (tl.includes("node proxy apis")) {
      return "Remove access to nodes/proxy unless there is a reviewed operational requirement, because kubelet-adjacent access expands the blast radius of credential misuse.";
    }
    if (tl.includes("grants wildcard access")) {
      return "Replace wildcard RBAC rules with explicit apiGroups, resources, and verbs so the role stays least-privilege as the cluster surface changes over time.";
    }
    if (tl.includes("crashloopbackoff")) {
      return "Inspect pod events and workload logs for the crashing deployment, fix the startup or configuration failure, and confirm the workload stabilizes.";
    }
    if (tl.includes("runs privileged")) {
      return "Drop privileged mode from the workload unless there is a documented hard requirement, and retest the pod with the narrower security context.";
    }
    if (tl.includes("allows privilege escalation")) {
      return "Set allowPrivilegeEscalation to false unless the workload has a documented exception, and verify the container still starts and serves traffic.";
    }
    if (tl.includes("automatically mounts service account tokens")) {
      return "Set automountServiceAccountToken to false for workloads that do not need direct Kubernetes API access, and use a narrower identity path only where required.";
    }
    if (tl.includes("uses the default service account with token automount")) {
      return "Move the workload off the default service account, grant only the RBAC it actually needs, and keep token automount disabled unless the pod must call the Kubernetes API directly.";
    }
    if (tl.includes("bulk-imports secret data into environment variables")) {
      return "Replace broad envFrom Secret imports with narrowly scoped secretKeyRef entries or mounted files so only the required keys reach the workload.";
    }
    if (tl.includes("injects secret values into environment variables")) {
      return "Review whether those secrets need to live in environment variables at all, and prefer narrower file-based mounts or workload identity where that reduces exposure.";
    }
    if (tl.includes("mounts secret volumes")) {
      return "Review each Secret volume mount, remove the ones the workload does not need, and scope the remaining mounts to the narrowest paths and keys possible.";
    }
    if (tl.includes("mounts projected service account token volumes")) {
      return "Remove projected service account token volumes unless the workload genuinely needs direct Kubernetes API access, and prefer narrower identity or audience-scoped tokens where that access is required.";
    }
    if (tl.includes("shares the host network namespace")) {
      return "Disable hostNetwork unless the workload has a documented platform-level need for direct node networking, then confirm the remaining exposed ports and policies still match intent.";
    }
    if (tl.includes("shares the host pid namespace")) {
      return "Disable hostPID unless the workload has a reviewed operational need for host process visibility, and verify the pod still functions with normal namespace isolation.";
    }
    if (tl.includes("shares the host ipc namespace")) {
      return "Disable hostIPC unless there is a tightly reviewed requirement for shared host IPC resources, and keep that exception narrow and documented.";
    }
    if (tl.includes("mounts hostpath volumes")) {
      return "Replace hostPath usage with safer Kubernetes storage primitives where possible, or narrow the node path and mount mode so the workload gets only the minimum host access it actually needs.";
    }
    if (tl.includes("adds linux capabilities")) {
      return "Drop added Linux capabilities such as NET_ADMIN unless the workload has a documented requirement, and rerun the pod with the narrowest possible capability set.";
    }
    if (tl.includes("uses privileged init containers")) {
      return "Remove privileged init containers unless they are truly required, and move any remaining bootstrap work to a narrower security context or a separately reviewed operational path.";
    }
    if (tl.includes("writable root filesystem")) {
      return "Set readOnlyRootFilesystem to true where possible, then move required writable state onto explicit volumes and confirm the workload still starts cleanly.";
    }
    if (tl.includes("writable mounted volumes")) {
      return "Review which mounted paths truly need write access, switch the rest to read-only, and confirm the workload still functions with the narrower filesystem permissions.";
    }
    if (tl.includes("runasnonroot")) {
      return "Set runAsNonRoot to true and align the image user so the workload does not rely on root execution.";
    }
    if (tl.includes("seccomp profile")) {
      return "Apply a RuntimeDefault or reviewed Localhost seccomp profile so the workload runs with a tighter syscall boundary.";
    }
    if (tl.includes("missing liveness or readiness probes")) {
      return "Add readiness and liveness probes for the workload so failed or unready pods are detected and handled by Kubernetes.";
    }
    if (tl.includes("missing resource requests or limits")) {
      return "Define CPU and memory requests and limits for the workload so scheduling, autoscaling, and noisy-neighbor protection behave predictably.";
    }
  }

  return finding.title;
}

function buildFallbackActions(
  findings: Finding[],
  env: EnvironmentContext,
  incomplete: boolean
): [string, string, string] {
  const fromFindings: string[] = [];
  for (const finding of findings.slice().sort(compareFindingsForFallback)) {
    const action = buildActionForFinding(finding, env);
    if (!fromFindings.includes(action)) {
      fromFindings.push(action);
    }
    if (fromFindings.length === 3) break;
  }

  if (
    incomplete &&
    !fromFindings.some((action) => action.includes("elevated privileges"))
  ) {
    fromFindings.unshift(
      "Rerun the audit with elevated privileges or collect the missing sections to restore full visibility."
    );
  }

  while (fromFindings.length < 3) {
    fromFindings.push(FILLER_ACTIONS[fromFindings.length]!);
  }

  if (env.is_container && fromFindings.length < 3) {
    fromFindings.push(
      "Capture a fresh container diagnostic after hardening to confirm the workload still exposes only the runtime settings you expect."
    );
  }
  return fromFindings.slice(0, 3) as [string, string, string];
}

interface LlmResult {
  report: AuditReport;
  tokensUsed: number;
}

function extractTokenUsage(response: Response): number {
  const usage = response.usage;
  if (!usage) return 0;
  return usage.total_tokens ?? usage.input_tokens + usage.output_tokens;
}

async function callLlm(
  client: OpenAI,
  model: string,
  env: EnvironmentContext,
  noise: NoiseItem[],
  preFindings: PreFinding[],
  sections: Record<string, string>,
  incomplete: boolean,
  incompleteReason?: string
): Promise<LlmResult> {
  const body: ResponseCreateParamsNonStreaming = {
    model,
    stream: false,
    instructions: buildSystemPrompt(),
    input: buildUserPrompt(env, noise, preFindings, sections, incomplete, incompleteReason),
    text: {
      format: auditReportResponseFormat(),
    },
  };

  const response = await client.responses.create(body);

  const tokensUsed = extractTokenUsage(response);

  const text = response.output_text;
  const parsed = JSON.parse(text);
  const report = AuditReportSchema.parse(parsed);
  return { report, tokensUsed };
}
