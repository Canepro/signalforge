import type { Finding, Severity } from "@/lib/analyzer/schema";

export type FindingSignal = "exposure" | "identity" | "hardening" | "stability" | "other";

export interface FindingSignalSummary {
  signal: Exclude<FindingSignal, "other">;
  label: string;
  description: string;
  count: number;
  highestSeverity: Severity | null;
  sampleTitle: string | null;
}

const severityRank: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const FINDING_SIGNAL_DEFINITIONS: Array<{
  signal: Exclude<FindingSignal, "other">;
  label: string;
  description: string;
}> = [
  {
    signal: "exposure",
    label: "Exposure",
    description: "Externally reachable surfaces and listener posture.",
  },
  {
    signal: "identity",
    label: "Identity & access",
    description: "RBAC, service accounts, tokens, and secret handling.",
  },
  {
    signal: "hardening",
    label: "Hardening gaps",
    description: "Privilege, isolation, filesystem, and runtime controls.",
  },
  {
    signal: "stability",
    label: "Instability & pressure",
    description: "Crash loops, pressure, probe gaps, and operational drift.",
  },
];

function textForFinding(finding: Finding): string {
  return [
    finding.category,
    finding.title,
    finding.why_it_matters,
    finding.recommended_action,
    finding.evidence,
  ]
    .join(" ")
    .toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function classifyFindingSignal(finding: Finding): FindingSignal {
  const text = textForFinding(finding);

  if (
    includesAny(text, [
      "cluster-admin",
      "rbac",
      "service account",
      "service-account",
      "automount",
      "projected service account token",
      "token",
      "secret env",
      "secret volume",
      "secret values",
      "mounted secrets",
      "sudo",
      "authorized_keys",
      "ssh permits root login",
    ])
  ) {
    return "identity";
  }

  if (
    includesAny(text, [
      "exposed externally",
      "externally exposed",
      "reachable on all network interfaces",
      "published ports",
      "publishes ports",
      "public service",
      "loadbalancer",
      "nodeport",
      "listener",
      "host network mode",
      "host network namespace",
    ])
  ) {
    return "exposure";
  }

  if (
    includesAny(text, [
      "privileged",
      "allow privilege escalation",
      "host pid",
      "host ipc",
      "hostpath",
      "host path",
      "docker socket",
      "capabilities",
      "runs as root",
      "root filesystem",
      "read-only",
      "password authentication enabled",
      "unconfined",
      "writable mounted volumes",
      "writable root filesystem",
    ])
  ) {
    return "hardening";
  }

  if (
    includesAny(text, [
      "crashloopbackoff",
      "unstable",
      "missing liveness or readiness probes",
      "probe",
      "disk usage",
      "packages pending upgrade",
      "pending upgrade",
      "error",
      "warning",
      "resource",
      "pressure",
      "restart",
      "oom",
    ])
  ) {
    return "stability";
  }

  return "other";
}

export function summarizeFindingSignals(findings: Finding[]): FindingSignalSummary[] {
  return FINDING_SIGNAL_DEFINITIONS.map((definition) => {
    const matching = findings.filter(
      (finding) => classifyFindingSignal(finding) === definition.signal
    );

    let highestSeverity: Severity | null = null;
    for (const finding of matching) {
      if (
        highestSeverity === null ||
        severityRank[finding.severity] > severityRank[highestSeverity]
      ) {
        highestSeverity = finding.severity;
      }
    }

    return {
      signal: definition.signal,
      label: definition.label,
      description: definition.description,
      count: matching.length,
      highestSeverity,
      sampleTitle: matching[0]?.title ?? null,
    };
  });
}
