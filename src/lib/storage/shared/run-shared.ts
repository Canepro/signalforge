import type { Finding } from "@/lib/analyzer/schema";
import { deriveSeverityCounts, parseEnvironmentHostname } from "@/lib/db/repository";
import type { RunSummary } from "@/types/api";

export type RunSummaryRowShape = {
  id: string;
  artifact_id: string;
  filename: string;
  artifact_type: string;
  source_type: string;
  created_at: string;
  status: string;
  report_json: string | null;
  environment_json: string | null;
  target_identifier: string | null;
  collector_type: string | null;
};

export function mapRunSummaryRow(row: RunSummaryRowShape): RunSummary {
  const hostname = parseEnvironmentHostname(row.environment_json);
  const env = safeParseJson<Record<string, boolean>>(row.environment_json, {});
  const env_tags: string[] = [];
  if (env.is_wsl) env_tags.push("WSL");
  if (env.is_container) env_tags.push("Container");
  if (env.is_virtual_machine) env_tags.push("VM");
  if (!env.is_wsl && !env.is_container && !env.is_virtual_machine && row.environment_json) {
    env_tags.push("Linux");
  }

  return {
    id: row.id,
    artifact_id: row.artifact_id,
    filename: row.filename,
    artifact_type: row.artifact_type,
    source_type: row.source_type,
    created_at: row.created_at,
    status: row.status,
    severity_counts: deriveSeverityCounts(row.report_json),
    hostname,
    env_tags,
    target_identifier: row.target_identifier ?? null,
    collector_type: row.collector_type ?? null,
  };
}

export function runAttentionScore(run: Pick<RunSummary, "severity_counts">): number {
  return (
    (run.severity_counts.critical ?? 0) * 1000 +
    (run.severity_counts.high ?? 0) * 100 +
    (run.severity_counts.medium ?? 0) * 10 +
    (run.severity_counts.low ?? 0)
  );
}

export function parseFindingsFromReportJson(reportJson: string | null): Finding[] {
  const parsed = safeParseJson<{ findings?: Finding[] } | null>(reportJson, null);
  if (!parsed || !Array.isArray(parsed.findings)) return [];
  return parsed.findings;
}

export type AgentSubmissionJobState = {
  source_id: string;
  artifact_type: string;
  status: string;
  lease_owner_id: string | null;
  lease_owner_instance_id: string | null;
  lease_expires_at: string | null;
  result_run_id: string | null;
  result_artifact_id: string | null;
};

export type AgentSubmissionInput = {
  sourceId: string;
  registrationId: string;
  instanceId: string;
  artifactType: string;
};

export type AgentSubmissionValidationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "wrong_source"
        | "artifact_type_mismatch"
        | "job_already_submitted"
        | "invalid_state"
        | "instance_mismatch"
        | "lease_expired";
      run_id?: string;
      artifact_id?: string;
    };

export function validateAgentSubmissionState(
  job: AgentSubmissionJobState,
  input: AgentSubmissionInput,
  nowIso = new Date().toISOString()
): AgentSubmissionValidationResult {
  if (job.source_id !== input.sourceId) {
    return { ok: false, code: "wrong_source" };
  }
  if (job.artifact_type !== input.artifactType) {
    return { ok: false, code: "artifact_type_mismatch" };
  }
  if (job.status === "submitted" && job.result_run_id && job.result_artifact_id) {
    return {
      ok: false,
      code: "job_already_submitted",
      run_id: job.result_run_id,
      artifact_id: job.result_artifact_id,
    };
  }
  if (
    job.status !== "running" ||
    job.lease_owner_id !== input.registrationId ||
    !job.lease_owner_instance_id
  ) {
    return { ok: false, code: "invalid_state" };
  }
  if (job.lease_owner_instance_id !== input.instanceId) {
    return { ok: false, code: "instance_mismatch" };
  }
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso) {
    return { ok: false, code: "lease_expired" };
  }
  return { ok: true };
}

export type RunSubmissionMetaShape = {
  filename: string;
  sourceType: string;
  ingestion: {
    target_identifier: string | null;
    source_label: string | null;
    collector_type: string | null;
    collector_version: string | null;
    collected_at: string | null;
  };
};

export function toRunSubmissionMeta(input: RunSubmissionMetaShape) {
  return {
    filename: input.filename,
    source_type: input.sourceType,
    target_identifier: input.ingestion.target_identifier,
    source_label: input.ingestion.source_label,
    collector_type: input.ingestion.collector_type,
    collector_version: input.ingestion.collector_version,
    collected_at: input.ingestion.collected_at,
  };
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
