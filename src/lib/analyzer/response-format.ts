import type { ResponseFormatTextJSONSchemaConfig } from "openai/resources/responses/responses.js";
import { auditReportJsonSchema } from "./schema";

/** Structured-output schema for `responses.create({ text: { format } })`. */
export function auditReportResponseFormat(): ResponseFormatTextJSONSchemaConfig {
  const spec = auditReportJsonSchema();
  return {
    type: "json_schema",
    name: String(spec.name),
    strict: spec.strict === undefined ? true : Boolean(spec.strict),
    schema: spec.schema as { [key: string]: unknown },
  };
}
