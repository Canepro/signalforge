import type { Finding, Severity } from "@/lib/analyzer/schema";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Trim, lowercase, collapse internal whitespace, then normalize known volatile title
 * fragments emitted by the deterministic rules. This keeps the comparison stable when
 * a finding's identity is the same but a count/percentage changes between runs.
 */
export function normalizeFindingTitle(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    /^\d+\s+packages?\s+(can be upgraded|available for upgrade|pending upgrade)$/.test(
      normalized
    )
  ) {
    return "packages pending upgrade";
  }

  if (/^\d+\s+failed authentication attempts detected$/.test(normalized)) {
    return "repeated failed authentication attempts detected";
  }

  if (/^\d+\s+non-trivial errors in recent logs$/.test(normalized)) {
    return "elevated non-trivial errors in recent logs";
  }

  const diskMatch = normalized.match(/^disk usage (critical|warning): (.+?) at \d+%$/);
  if (diskMatch) {
    return `disk usage ${diskMatch[1]}: ${diskMatch[2]}`;
  }

  const listenerKey = normalizeListenerFindingTitle(normalized);
  if (listenerKey !== null) {
    return listenerKey;
  }

  if (/^container publishes ports: .+$/.test(normalized)) {
    return "container publishes ports";
  }

  const kubernetesCountStableTitle = normalizeKubernetesCountStableTitle(normalized);
  if (kubernetesCountStableTitle !== null) {
    return kubernetesCountStableTitle;
  }

  return normalized;
}

/**
 * Listener titles are reworded as identification improves; keep compare keys stable
 * on port + bind scope + (for specific binds) address.
 */
function normalizeListenerFindingTitle(normalized: string): string | null {
  const portTail = normalized.match(/ \(port (\d+)\)$/);
  if (!portTail) return null;

  const port = portTail[1];

  if (normalized.includes("listening on loopback only")) {
    return `network listener loopback port ${port}`;
  }

  if (
    normalized.includes("exposed on all interfaces") ||
    normalized.includes("reachable on all network interfaces")
  ) {
    return `network listener all interfaces port ${port}`;
  }

  const bound = normalized.match(/^(.+?) bound to (.+?) \(port (\d+)\)$/);
  if (bound) {
    return `network listener bound ${bound[2]} port ${bound[3]}`;
  }

  return null;
}

function normalizeKubernetesCountStableTitle(normalized: string): string | null {
  const countStablePatterns = [
    /^(kubernetes workload service account is bound to wildcard rbac roles: .+?) \(\d+ roles\)$/,
    /^(kubernetes externally exposed workload service account is bound to wildcard rbac roles: .+?) \(\d+ roles\)$/,
    /^(kubernetes workload service account is bound to privilege-escalation rbac roles: .+?) \(\d+ roles\)$/,
    /^(kubernetes externally exposed workload service account is bound to privilege-escalation rbac roles: .+?) \(\d+ roles\)$/,
    /^(kubernetes workload service account is bound to node proxy rbac roles: .+?) \(\d+ roles\)$/,
    /^(kubernetes externally exposed workload service account is bound to node proxy rbac roles: .+?) \(\d+ roles\)$/,
    /^(kubernetes workload injects secret values into environment variables: .+?) \(\d+ refs\)$/,
    /^(kubernetes workload bulk-imports secret data into environment variables: .+?) \(\d+ refs\)$/,
    /^(kubernetes workload mounts secret volumes: .+?) \(\d+ mounts\)$/,
    /^(kubernetes workload mounts projected service account token volumes: .+?) \(\d+ mounts\)$/,
    /^(kubernetes workload mounts hostpath volumes: .+?) \(\d+ mounts\)$/,
    /^(kubernetes workload adds linux capabilities: .+?) \(\d+ capabilities\)$/,
    /^(kubernetes workload uses privileged init containers: .+?) \(\d+ containers\)$/,
  ];

  for (const pattern of countStablePatterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Deterministic finding match key (no LLM):
 *
 * Two findings from different runs match iff they share:
 * - the same `category` (exact string as stored),
 * - the same normalized title (`normalizeFindingTitle`), with numeric drift removed
 *   for count/percentage-based findings such as package counts, auth error counts,
 *   log error counts, and disk-usage percentages,
 * - the same `section_source` (exact string as stored).
 *
 * Collisions: if multiple findings in one run share the same key, the first occurrence wins
 * when indexing; later duplicates are ignored for matching (documented limitation).
 */
export function findingMatchKey(f: {
  category: string;
  title: string;
  section_source: string;
}): string {
  return `${f.category}\0${normalizeFindingTitle(f.title)}\0${f.section_source}`;
}

export type DriftStatus = "new" | "resolved" | "severity_up" | "severity_down" | "unchanged";

export interface FindingCompareRow {
  match_key: string;
  status: DriftStatus;
  title: string;
  category: string;
  section_source: string;
  previous_severity: Severity | null;
  current_severity: Severity | null;
  evidence_previous: string | null;
  evidence_current: string | null;
}

export interface FindingsDriftResult {
  summary: {
    new: number;
    resolved: number;
    severity_up: number;
    severity_down: number;
    unchanged: number;
  };
  /** Only changed rows (excludes unchanged); sorted by match_key for stable UI. */
  rows: FindingCompareRow[];
}

function indexByMatchKey(findings: Finding[]): Map<string, Finding> {
  const m = new Map<string, Finding>();
  for (const f of findings) {
    const k = findingMatchKey(f);
    if (!m.has(k)) m.set(k, f);
  }
  return m;
}

/**
 * Compare baseline (previous) findings to current findings.
 * - `new`: present in current only
 * - `resolved`: present in baseline only
 * - `severity_up` / `severity_down`: same match key, severity rank changed
 */
export function compareFindingsDrift(
  baselineFindings: Finding[],
  currentFindings: Finding[]
): FindingsDriftResult {
  const prevMap = indexByMatchKey(baselineFindings);
  const currMap = indexByMatchKey(currentFindings);
  const keys = new Set<string>([...prevMap.keys(), ...currMap.keys()]);
  const sortedKeys = [...keys].sort();

  const rows: FindingCompareRow[] = [];
  let newC = 0;
  let resolvedC = 0;
  let upC = 0;
  let downC = 0;
  let unchangedC = 0;

  for (const key of sortedKeys) {
    const p = prevMap.get(key);
    const c = currMap.get(key);

    if (!p && c) {
      newC++;
      rows.push({
        match_key: key,
        status: "new",
        title: c.title,
        category: c.category,
        section_source: c.section_source,
        previous_severity: null,
        current_severity: c.severity,
        evidence_previous: null,
        evidence_current: c.evidence,
      });
      continue;
    }

    if (p && !c) {
      resolvedC++;
      rows.push({
        match_key: key,
        status: "resolved",
        title: p.title,
        category: p.category,
        section_source: p.section_source,
        previous_severity: p.severity,
        current_severity: null,
        evidence_previous: p.evidence,
        evidence_current: null,
      });
      continue;
    }

    if (p && c) {
      const pr = SEVERITY_RANK[p.severity];
      const cr = SEVERITY_RANK[c.severity];
      if (pr === cr) {
        unchangedC++;
        continue;
      }
      if (cr > pr) {
        upC++;
        rows.push({
          match_key: key,
          status: "severity_up",
          title: c.title,
          category: c.category,
          section_source: c.section_source,
          previous_severity: p.severity,
          current_severity: c.severity,
          evidence_previous: p.evidence,
          evidence_current: c.evidence,
        });
      } else {
        downC++;
        rows.push({
          match_key: key,
          status: "severity_down",
          title: c.title,
          category: c.category,
          section_source: c.section_source,
          previous_severity: p.severity,
          current_severity: c.severity,
          evidence_previous: p.evidence,
          evidence_current: c.evidence,
        });
      }
    }
  }

  return {
    summary: {
      new: newC,
      resolved: resolvedC,
      severity_up: upC,
      severity_down: downC,
      unchanged: unchangedC,
    },
    rows,
  };
}
