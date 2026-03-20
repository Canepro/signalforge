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
  title: z.string(),
  severity: SeveritySchema,
  category: z.string(),
  section_source: z.string(),
  evidence: z.string(),
  why_it_matters: z.string(),
  recommended_action: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AuditReportSchema = z.object({
  summary: z.array(z.string()).min(1).max(7),
  findings: z.array(FindingSchema),
  environment_context: EnvironmentContextSchema,
  noise_or_expected: z.array(NoiseItemSchema),
  top_actions_now: z.array(z.string()).min(1).max(5),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

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
          description: "Exactly 3 prioritized actions",
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
