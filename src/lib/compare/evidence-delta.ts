import type { Severity } from "@/lib/analyzer/schema";
import { parseEnvironmentHostname, type RunWithArtifactRow } from "@/lib/db/repository";
import {
  parseContainerList,
  parseContainerSections,
} from "@/lib/adapter/container-diagnostics/parse";

export type EvidenceDeltaStatus = "changed" | "unchanged" | "added" | "removed";

export interface EvidenceDeltaMetricRow {
  key: string;
  label: string;
  family: "common" | "linux-audit-log" | "container-diagnostics" | "kubernetes-bundle";
  status: EvidenceDeltaStatus;
  previous: string | number | boolean | null;
  current: string | number | boolean | null;
  unit: string | null;
}

export interface EvidenceDeltaPayload {
  changed: boolean;
  summary: {
    metadata_changed: number;
    metric_changes: number;
    artifact_changed: boolean;
  };
  metadata: {
    filename: EvidenceDeltaStatus;
    target_identifier: EvidenceDeltaStatus;
    collected_at: EvidenceDeltaStatus;
    collector_type: EvidenceDeltaStatus;
    collector_version: EvidenceDeltaStatus;
  };
  metrics: EvidenceDeltaMetricRow[];
}

type ContainerEvidenceSummary = {
  published_port_count: number;
  added_capability_count: number;
  secret_mount_count: number;
};

function parseReport(reportJson: string | null): { findings?: { severity?: Severity }[] } {
  if (!reportJson) return {};
  try {
    return JSON.parse(reportJson) as { findings?: { severity?: Severity }[] };
  } catch {
    return {};
  }
}

function parseNoiseCount(noiseJson: string | null): number {
  if (!noiseJson) return 0;
  try {
    const items = JSON.parse(noiseJson) as unknown[];
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

function deltaStatus(
  previous: string | number | boolean | null | undefined,
  current: string | number | boolean | null | undefined
): EvidenceDeltaStatus {
  const prev = previous ?? null;
  const curr = current ?? null;
  if (prev === curr) return "unchanged";
  if (prev === null) return "added";
  if (curr === null) return "removed";
  return "changed";
}

function metricRow(
  key: string,
  label: string,
  previous: string | number | boolean | null,
  current: string | number | boolean | null,
  family: EvidenceDeltaMetricRow["family"] = "common",
  unit: string | null = null
): EvidenceDeltaMetricRow | null {
  const status = deltaStatus(previous, current);
  if (status === "unchanged") return null;
  return { key, label, family, status, previous, current, unit };
}

function severityCounts(reportJson: string | null): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const finding of parseReport(reportJson).findings ?? []) {
    const severity = finding.severity;
    if (severity && severity in counts) counts[severity]++;
  }
  return counts;
}

export function buildEvidenceDelta(
  baseline: RunWithArtifactRow | null,
  current: RunWithArtifactRow
): EvidenceDeltaPayload | null {
  if (!baseline) return null;

  const metadata = {
    filename: deltaStatus(baseline.filename, current.filename),
    target_identifier: deltaStatus(baseline.target_identifier, current.target_identifier),
    collected_at: deltaStatus(baseline.collected_at, current.collected_at),
    collector_type: deltaStatus(baseline.collector_type, current.collector_type),
    collector_version: deltaStatus(baseline.collector_version, current.collector_version),
  };

  const baselineSeverityCounts = severityCounts(baseline.report_json);
  const currentSeverityCounts = severityCounts(current.report_json);
  const metrics = [
    metricRow(
      "environment_hostname",
      "Hostname",
      parseEnvironmentHostname(baseline.environment_json),
      parseEnvironmentHostname(current.environment_json)
    ),
    metricRow(
      "finding_count",
      "Finding count",
      (parseReport(baseline.report_json).findings ?? []).length,
      (parseReport(current.report_json).findings ?? []).length
    ),
    metricRow(
      "suppressed_noise_count",
      "Suppressed noise",
      parseNoiseCount(baseline.noise_json),
      parseNoiseCount(current.noise_json)
    ),
    metricRow(
      "incomplete_audit",
      "Incomplete audit",
      Boolean(baseline.is_incomplete),
      Boolean(current.is_incomplete)
    ),
    metricRow(
      "critical_findings",
      "Critical findings",
      baselineSeverityCounts.critical,
      currentSeverityCounts.critical
    ),
    metricRow(
      "high_findings",
      "High findings",
      baselineSeverityCounts.high,
      currentSeverityCounts.high
    ),
    metricRow(
      "medium_findings",
      "Medium findings",
      baselineSeverityCounts.medium,
      currentSeverityCounts.medium
    ),
    metricRow(
      "low_findings",
      "Low findings",
      baselineSeverityCounts.low,
      currentSeverityCounts.low
    ),
    ...buildFamilyMetrics(baseline, current),
  ].filter((row): row is EvidenceDeltaMetricRow => row !== null);

  const metadataChanged = Object.values(metadata).filter((status) => status !== "unchanged").length;
  const artifactChanged = baseline.artifact_id !== current.artifact_id;

  return {
    changed: artifactChanged || metadataChanged > 0 || metrics.length > 0,
    summary: {
      metadata_changed: metadataChanged,
      metric_changes: metrics.length,
      artifact_changed: artifactChanged,
    },
    metadata,
    metrics,
  };
}

function summarizeContainerEvidence(content: string): ContainerEvidenceSummary {
  const sections = parseContainerSections(content);
  return {
    published_port_count: parseContainerList(sections.published_ports).length,
    added_capability_count: parseContainerList(sections.added_capabilities).length,
    secret_mount_count: parseContainerList(sections.secrets).length,
  };
}

function buildFamilyMetrics(
  baseline: RunWithArtifactRow,
  current: RunWithArtifactRow
): Array<EvidenceDeltaMetricRow | null> {
  if (baseline.artifact_type !== current.artifact_type) return [];

  if (current.artifact_type === "container-diagnostics") {
    const previous = summarizeContainerEvidence(baseline.artifact_content);
    const next = summarizeContainerEvidence(current.artifact_content);
    return [
      metricRow(
        "published_port_count",
        "Published ports",
        previous.published_port_count,
        next.published_port_count,
        "container-diagnostics"
      ),
      metricRow(
        "added_capability_count",
        "Added Linux capabilities",
        previous.added_capability_count,
        next.added_capability_count,
        "container-diagnostics"
      ),
      metricRow(
        "secret_mount_count",
        "Mounted secrets",
        previous.secret_mount_count,
        next.secret_mount_count,
        "container-diagnostics"
      ),
    ];
  }

  return [];
}
