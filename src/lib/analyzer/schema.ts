import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const EnvironmentContextSchema = z.object({
  hostname: z.string(),
  os: z.string(),
  kernel: z.string(),
  is_wsl: z.boolean(),
  is_container: z.boolean(),
  is_virtual_machine: z.boolean(),
  ran_as_root: z.boolean(),
  uptime: z.string(),
});
export type EnvironmentContext = z.infer<typeof EnvironmentContextSchema>;

export const NoiseItemSchema = z.object({
  observation: z.string(),
  reason_expected: z.string(),
  related_environment: z.string(),
});
export type NoiseItem = z.infer<typeof NoiseItemSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  rule_id: z.string().optional(),
  title: z.string(),
  severity: SeveritySchema,
  category: z.string(),
  section_source: z.string(),
  evidence: z.string(),
  why_it_matters: z.string(),
  recommended_action: z.string(),
  action_gate: z.enum(["safe-immediate", "review-required", "operator-verify"]).optional(),
  risk_domain: z
    .enum(["housekeeping", "availability_risk", "security", "network", "resource", "unknown"])
    .optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const TopActionItemSchema = z.object({
  rank: z.number().int().min(1).max(3),
  action_gate: z.enum(["safe-immediate", "review-required", "operator-verify"]),
  label: z.string(),
  text: z.string(),
  source_rule_id: z.string().optional(),
});
export type TopActionItem = z.infer<typeof TopActionItemSchema>;

export const MacDiskPressureReportContextSchema = z.object({
  kind: z.literal("mac-disk-cleanup"),
  root_volume: z.object({
    used_percent: z.number().nullable(),
    capacity_band: z.enum(["normal", "warning", "urgent", "unknown"]),
    final_free_bytes: z.number().nullable(),
    free_space_band: z.enum(["normal", "warning", "urgent", "unknown"]),
  }),
  daily_cleanup: z.object({
    report_status: z.string(),
    age_hours: z.number().nullable(),
    freshness: z.enum(["fresh", "stale", "missing", "invalid", "unknown"]),
    final_free_bytes: z.number().nullable(),
    free_space_delta_bytes: z.number().nullable(),
    needs_review_count: z.number().nullable(),
    stale_manual_review_candidates: z.number(),
    missing_path_prune_candidates: z.number(),
  }),
  finding_domains: z.array(
    z.object({
      rule_id: z.string(),
      domain: z.enum(["housekeeping", "availability_risk"]),
      reason: z.string(),
    })
  ),
});
export type MacDiskPressureReportContext = z.infer<typeof MacDiskPressureReportContextSchema>;

export const ReportContextSchema = z.object({
  mac_disk_cleanup: MacDiskPressureReportContextSchema.optional(),
});
export type ReportContext = z.infer<typeof ReportContextSchema>;

export const AuditReportSchema = z.object({
  summary: z.array(z.string()).min(1).max(7),
  findings: z.array(FindingSchema),
  environment_context: EnvironmentContextSchema,
  noise_or_expected: z.array(NoiseItemSchema),
  top_actions_now: z.array(z.string()).length(3),
  top_action_items: z.array(TopActionItemSchema).length(3).optional(),
  report_context: ReportContextSchema.optional(),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const FindingNoteSchema = z.object({
  id: z.string(),
  why_it_matters: z.string(),
  recommended_action: z.string(),
});
export type FindingNote = z.infer<typeof FindingNoteSchema>;

export const AuditEnrichmentSchema = z.object({
  summary: z.array(z.string()).min(1).max(7),
  top_actions_now: z.array(z.string()).length(3),
  finding_notes: z.array(FindingNoteSchema).max(40),
});
export type AuditEnrichment = z.infer<typeof AuditEnrichmentSchema>;

export const PreFindingSchema = z.object({
  title: z.string(),
  severity_hint: SeveritySchema,
  category: z.string(),
  section_source: z.string(),
  evidence: z.string(),
  rule_id: z.string(),
});
export type PreFinding = z.infer<typeof PreFindingSchema>;

export const AnalysisResultSchema = z.object({
  report: AuditReportSchema.nullable(),
  environment: EnvironmentContextSchema,
  noise: z.array(NoiseItemSchema),
  pre_findings: z.array(PreFindingSchema),
  is_incomplete: z.boolean(),
  incomplete_reason: z.string().optional(),
  analysis_error: z.string().optional(),
  meta: z.object({
    model_used: z.string(),
    tokens_used: z.number(),
    duration_ms: z.number(),
    llm_succeeded: z.boolean(),
  }),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export function auditReportJsonSchema(): Record<string, unknown> {
  return {
    name: "audit_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        summary: {
          type: "array",
          items: { type: "string" },
          description: "3-5 bullet points summarizing the overall posture",
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              severity: {
                type: "string",
                enum: ["critical", "high", "medium", "low"],
              },
              category: { type: "string" },
              section_source: { type: "string" },
              evidence: { type: "string" },
              why_it_matters: { type: "string" },
              recommended_action: { type: "string" },
            },
            required: [
              "id",
              "title",
              "severity",
              "category",
              "section_source",
              "evidence",
              "why_it_matters",
              "recommended_action",
            ],
            additionalProperties: false,
          },
        },
        environment_context: {
          type: "object",
          properties: {
            hostname: { type: "string" },
            os: { type: "string" },
            kernel: { type: "string" },
            is_wsl: { type: "boolean" },
            is_container: { type: "boolean" },
            is_virtual_machine: { type: "boolean" },
            ran_as_root: { type: "boolean" },
            uptime: { type: "string" },
          },
          required: [
            "hostname",
            "os",
            "kernel",
            "is_wsl",
            "is_container",
            "is_virtual_machine",
            "ran_as_root",
            "uptime",
          ],
          additionalProperties: false,
        },
        noise_or_expected: {
          type: "array",
          items: {
            type: "object",
            properties: {
              observation: { type: "string" },
              reason_expected: { type: "string" },
              related_environment: { type: "string" },
            },
            required: ["observation", "reason_expected", "related_environment"],
            additionalProperties: false,
          },
        },
        top_actions_now: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 3,
          description: "Exactly 3 prioritized actions, ordered by impact",
        },
      },
      required: [
        "summary",
        "findings",
        "environment_context",
        "noise_or_expected",
        "top_actions_now",
      ],
      additionalProperties: false,
    },
  };
}

export function auditEnrichmentJsonSchema(): Record<string, unknown> {
  return {
    name: "audit_enrichment",
    strict: true,
    schema: {
      type: "object",
      properties: {
        summary: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 7,
          description: "3-5 bullet points summarizing the overall posture",
        },
        top_actions_now: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 3,
          description: "Exactly 3 prioritized actions, ordered by impact",
        },
        finding_notes: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              why_it_matters: { type: "string" },
              recommended_action: { type: "string" },
            },
            required: ["id", "why_it_matters", "recommended_action"],
            additionalProperties: false,
          },
          description:
            "Optional enrichment for the highest-signal finding IDs included in the prompt.",
        },
      },
      required: ["summary", "top_actions_now", "finding_notes"],
      additionalProperties: false,
    },
  };
}
