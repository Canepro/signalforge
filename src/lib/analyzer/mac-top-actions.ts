import type { EnvironmentContext, Finding, PreFinding, Severity } from "./schema";

export type MacActionGate = "safe-immediate" | "review-required" | "authority-gated";

const GATE_LABEL: Record<MacActionGate, string> = {
  "safe-immediate": "safe-immediate",
  "review-required": "review-required",
  "authority-gated": "authority-gated",
};

const CLEANUP_RERUN_RULE_IDS = new Set([
  "mac.daily_cleanup_report_stale",
  "mac.daily_cleanup_report_missing",
  "mac.daily_cleanup_report_invalid",
  "mac.daily_cleanup_ineffective_under_pressure",
]);

export function formatMacTopAction(gate: MacActionGate, action: string): string {
  return `[${GATE_LABEL[gate]}] ${action}`;
}

function ruleIdForFinding(finding: Finding, preFindings: PreFinding[]): string | undefined {
  const index = parseInt(finding.id.replace(/\D/g, ""), 10) - 1;
  return preFindings[index]?.rule_id;
}

function severityWeight(severity: Severity): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

function gateForMacRule(ruleId: string | undefined, finding: Finding): MacActionGate {
  switch (ruleId) {
    case "mac.daily_cleanup_prune_candidates":
      return "safe-immediate";
    case "mac.daily_cleanup_stale_review_candidates":
    case "mac.daily_cleanup_large_protected_stores":
    case "mac.disk_pressure":
    case "mac.disk_pressure_operational_posture":
      return "review-required";
    case "mac.daily_cleanup_report_stale":
    case "mac.daily_cleanup_report_missing":
    case "mac.daily_cleanup_report_invalid":
    case "mac.daily_cleanup_ineffective_under_pressure":
      return "authority-gated";
    case "mac.filevault_disabled":
    case "mac.sip_disabled":
      return "authority-gated";
    case "mac.firewall_disabled":
    case "mac.remote_access_posture":
    case "mac.wildcard_listeners_unknown":
    case "mac.wildcard_listeners_local_dev":
      return "review-required";
    default:
      if (finding.category === "security") return "authority-gated";
      if (finding.category === "network") return "review-required";
      return "review-required";
  }
}

function macActionPriority(ruleId: string | undefined, finding: Finding): number {
  const title = finding.title.toLowerCase();
  if (ruleId === "mac.disk_pressure_operational_posture") return 100;
  if (ruleId === "mac.daily_cleanup_ineffective_under_pressure") return 95;
  if (ruleId === "mac.daily_cleanup_report_stale" || ruleId === "mac.daily_cleanup_report_invalid") {
    return 90;
  }
  if (ruleId === "mac.disk_pressure") return 85;
  if (ruleId === "mac.daily_cleanup_large_protected_stores") return 80;
  if (ruleId === "mac.daily_cleanup_stale_review_candidates") return 75;
  if (ruleId === "mac.daily_cleanup_prune_candidates") return 70;
  if (ruleId === "mac.remote_access_posture" || title.includes("remote access posture")) return 65;
  if (ruleId === "mac.wildcard_listeners_unknown") return 60;
  if (ruleId === "mac.firewall_disabled") return 55;
  if (ruleId === "mac.filevault_disabled" || ruleId === "mac.sip_disabled") return 50;
  return 10;
}

function isHighSignalExposureFinding(finding: Finding): boolean {
  const sev = severityWeight(finding.severity);
  return (finding.category === "network" || finding.category === "security") && sev >= 3;
}

function isUrgentDiskPressureFinding(ruleId: string | undefined, finding: Finding): boolean {
  if (ruleId === "mac.disk_pressure" && finding.severity === "high") {
    return true;
  }
  return (
    ruleId === "mac.disk_pressure_operational_posture" &&
    finding.evidence.includes("pressure_band=urgent")
  );
}

function effectiveMacActionScore(ruleId: string | undefined, finding: Finding): number {
  const base = macActionPriority(ruleId, finding);
  const sev = severityWeight(finding.severity);

  if (isHighSignalExposureFinding(finding)) {
    return 1000 + sev * 10 + base;
  }

  if (isUrgentDiskPressureFinding(ruleId, finding)) {
    return 900 + sev * 10 + base;
  }

  return base + sev * 10;
}

function actionDedupeKey(ruleId: string | undefined): string | null {
  if (ruleId && CLEANUP_RERUN_RULE_IDS.has(ruleId)) {
    return "cleanup-rerun";
  }
  return ruleId ?? null;
}

function extractRepoFromEvidence(evidence: string): string | null {
  const match = evidence.match(/\/Users\/[^/]+\/src\/[^/]+/);
  return match?.[0] ?? null;
}

function buildUnifiedCleanupRerunAction(env: EnvironmentContext): string {
  return formatMacTopAction(
    "authority-gated",
    `On ${env.hostname}: rerun the local daily-cleanup script, review protected retained stores and the manual-review backlog, then resubmit mac-diagnostics so SignalForge can re-score cleanup freshness and disk delta.`
  );
}

function buildMacActionForFinding(
  finding: Finding,
  ruleId: string | undefined,
  env: EnvironmentContext
): string {
  const gate = gateForMacRule(ruleId, finding);
  const tl = finding.title.toLowerCase();
  const evidence = finding.evidence;

  if (ruleId && CLEANUP_RERUN_RULE_IDS.has(ruleId)) {
    return buildUnifiedCleanupRerunAction(env);
  }

  if (ruleId === "mac.daily_cleanup_prune_candidates") {
    const repo = extractRepoFromEvidence(evidence);
    const repoHint = repo ? ` in ${repo}` : " in the owning repo";
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: run \`git worktree prune\`${repoHint} after confirming the missing worktree path is obsolete, then resubmit mac-diagnostics for verification.`
    );
  }

  if (ruleId === "mac.daily_cleanup_stale_review_candidates") {
    const candidateHint = evidence.split(";")[0]?.trim() || "listed stale worktree candidates";
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: review ${candidateHint}; remove only worktrees whose branches are confirmed obsolete, then resubmit mac-diagnostics to confirm disk pressure and review-queue drift.`
    );
  }

  if (ruleId === "mac.daily_cleanup_large_protected_stores") {
    const storeHint = evidence.split(";")[0]?.trim() || "protected retained stores";
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: review ${storeHint} as owner-approved disk consumers; widen cleanup scope only after explicit owner approval, then resubmit mac-diagnostics.`
    );
  }

  if (ruleId === "mac.disk_pressure_operational_posture") {
    const band = evidence.match(/pressure_band=(warning|urgent)/)?.[1] ?? "elevated";
    return formatMacTopAction(
      gate,
      `Treat ${env.hostname} as ${band} disk pressure with correlated cleanup drift: prioritize freeing root volume space and clearing stale manual-review items via Mira/Codex on the workstation, then resubmit mac-diagnostics for proof.`
    );
  }

  if (ruleId === "mac.disk_pressure" || tl.includes("disk pressure")) {
    const band = evidence.match(/pressure_band=(warning|urgent)/)?.[1] ?? "elevated";
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: reduce root volume usage below the ${band} threshold by moving rebuildable artifacts or deleting confirmed-obsolete local stores; resubmit mac-diagnostics after changes.`
    );
  }

  if (ruleId === "mac.remote_access_posture" || tl.includes("remote access posture")) {
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: reconcile remote-login and listener exposure with policy (disable SSH or restrict to VPN/admin paths if broad reachability is unintended), then resubmit mac-diagnostics.`
    );
  }

  if (ruleId === "mac.firewall_disabled") {
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: enable the macOS application firewall or document the approved exception; resubmit mac-diagnostics after the change.`
    );
  }

  if (ruleId === "mac.wildcard_listeners_unknown") {
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: identify wildcard listeners from the evidence, stop or rebind any unintended services, then resubmit mac-diagnostics.`
    );
  }

  if (ruleId === "mac.filevault_disabled") {
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: enable FileVault or record the approved exception with recovery-key escrow; resubmit mac-diagnostics after enrollment state changes.`
    );
  }

  if (ruleId === "mac.sip_disabled") {
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: re-enable System Integrity Protection from macOS Recovery unless a documented time-bounded exception exists.`
    );
  }

  if (ruleId === "mac.homebrew_outdated") {
    return formatMacTopAction(
      gate,
      `On ${env.hostname}: apply pending Homebrew upgrades, then resubmit mac-diagnostics to confirm the tooling backlog is clear.`
    );
  }

  return formatMacTopAction(gate, finding.recommended_action || finding.title);
}

function compareMacFindings(
  a: Finding,
  b: Finding,
  preFindings: PreFinding[]
): number {
  const aRule = ruleIdForFinding(a, preFindings);
  const bRule = ruleIdForFinding(b, preFindings);
  const byScore =
    effectiveMacActionScore(bRule, b) - effectiveMacActionScore(aRule, a);
  if (byScore !== 0) return byScore;

  return severityWeight(b.severity) - severityWeight(a.severity);
}

export function isMacDiagnosticsRun(preFindings: PreFinding[]): boolean {
  return preFindings.some((finding) => finding.rule_id.startsWith("mac."));
}

export function buildMacTopActions(
  findings: Finding[],
  preFindings: PreFinding[],
  env: EnvironmentContext,
  incomplete: boolean
): [string, string, string] {
  const actions: string[] = [];
  const seenDedupeKeys = new Set<string>();

  for (const finding of findings.slice().sort((a, b) => compareMacFindings(a, b, preFindings))) {
    const ruleId = ruleIdForFinding(finding, preFindings);
    const dedupeKey = actionDedupeKey(ruleId);
    if (dedupeKey && seenDedupeKeys.has(dedupeKey)) {
      continue;
    }

    const action = buildMacActionForFinding(finding, ruleId, env);
    if (!actions.includes(action)) {
      actions.push(action);
      if (dedupeKey) {
        seenDedupeKeys.add(dedupeKey);
      }
    }
    if (actions.length === 3) break;
  }

  if (
    incomplete &&
    !actions.some((action) => action.toLowerCase().includes("elevated privileges"))
  ) {
    actions.unshift(
      formatMacTopAction(
        "authority-gated",
        `On ${env.hostname}: rerun mac-diagnostics with elevated privileges or complete missing sections, then resubmit so SignalForge can restore full workstation visibility.`
      )
    );
  }

  const fillers: [string, string, string] = [
    formatMacTopAction(
      "review-required",
      "Review the full findings table in SignalForge and route execution to Mira/Codex on the workstation — SignalForge scores evidence and recommends, it does not run fixes."
    ),
    formatMacTopAction(
      "safe-immediate",
      `Resubmit mac-diagnostics on ${env.hostname} after any workstation change so compare and drift scoring stay current.`
    ),
    formatMacTopAction(
      "review-required",
      "Use compare runs to confirm disk-pressure and cleanup drift trends before closing the incident."
    ),
  ];

  while (actions.length < 3) {
    actions.push(fillers[actions.length]!);
  }

  return actions.slice(0, 3) as [string, string, string];
}

export function resolveMacTopActions(
  findings: Finding[],
  preFindings: PreFinding[],
  env: EnvironmentContext,
  incomplete: boolean
): [string, string, string] | null {
  if (!isMacDiagnosticsRun(preFindings)) {
    return null;
  }
  return buildMacTopActions(findings, preFindings, env, incomplete);
}