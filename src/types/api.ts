import type {
  AuditReport,
  EnvironmentContext,
  NoiseItem,
  PreFinding,
} from "@/lib/analyzer/schema";

export interface RunSummary {
  id: string;
  artifact_id: string;
  filename: string;
  artifact_type: string;
  source_type: string;
  created_at: string;
  created_at_label?: string;
  status: string;
  severity_counts: Record<string, number>;
  hostname: string | null;
  env_tags: string[];
  /** Ingestion metadata (Phase 5a); null if unset. */
  target_identifier: string | null;
  collector_type: string | null;
}

export interface RunDetail {
  id: string;
  artifact_id: string;
  parent_run_id: string | null;
  /** Present on GET /api/runs/[id]; relative paths for UI vs JSON drift/compare. */
  links?: {
    compare_ui: string;
    compare_api: string;
  };
  /** Present when this run was created via reanalyze; links to prior run. */
  parent_run?: { id: string; filename: string } | null;
  filename: string;
  artifact_type: string;
  source_type: string;
  /** Phase 5a ingestion metadata; null when unset. */
  target_identifier: string | null;
  source_label: string | null;
  collector_type: string | null;
  collector_version: string | null;
  collected_at: string | null;
  collected_at_label?: string | null;
  created_at: string;
  created_at_label?: string;
  status: string;
  is_incomplete: boolean;
  incomplete_reason: string | null;
  analysis_error: string | null;
  model_used: string | null;
  tokens_used: number;
  duration_ms: number;
  severity_counts: Record<string, number>;
  report: AuditReport | null;
  environment: EnvironmentContext | null;
  noise: NoiseItem[] | null;
  pre_findings: PreFinding[] | null;
}
