import {
  AuditEnrichmentSchema,
  AuditReportSchema,
  type AuditEnrichment,
  type AuditReport,
} from "../schema";

function tryParseAuditReport(value: unknown): AuditReport | null {
  const parsed = AuditReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function tryParseAuditEnrichment(value: unknown): AuditEnrichment | null {
  const parsed = AuditEnrichmentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function tryParseAuditReportJson(text: string): AuditReport | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return tryParseAuditReport(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function tryParseAuditEnrichmentJson(text: string): AuditEnrichment | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return tryParseAuditEnrichment(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/**
 * Extract a strict audit report from Codex app-server turn notifications/responses.
 */
export function extractAuditReportFromCodexTurnPayload(payload: unknown): AuditReport | null {
  const direct = tryParseAuditReport(payload);
  if (direct) return direct;

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    const params = record.params;
    if (params && typeof params === "object") {
      const fromParams = extractAuditReportFromCodexTurnPayload(params);
      if (fromParams) return fromParams;
    }

    for (const key of [
      "structuredOutput",
      "structured_output",
      "structuredContent",
      "structured_content",
      "output",
      "finalOutput",
      "final_output",
      "report",
    ]) {
      const candidate = tryParseAuditReport(record[key]);
      if (candidate) return candidate;
    }

    const turn = record.turn;
    if (turn && typeof turn === "object") {
      const fromTurn = extractAuditReportFromCodexTurnPayload(turn);
      if (fromTurn) return fromTurn;
    }

    const items = record.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const fromItem = extractAuditReportFromCodexTurnPayload(item);
        if (fromItem) return fromItem;
      }
    }
  }

  const strings: string[] = [];
  collectStrings(payload, strings);
  for (const text of strings) {
    const fromText = tryParseAuditReportJson(text);
    if (fromText) return fromText;
  }

  return null;
}

export function extractAuditEnrichmentFromCodexTurnPayload(
  payload: unknown
): AuditEnrichment | null {
  const direct = tryParseAuditEnrichment(payload);
  if (direct) return direct;

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    const params = record.params;
    if (params && typeof params === "object") {
      const fromParams = extractAuditEnrichmentFromCodexTurnPayload(params);
      if (fromParams) return fromParams;
    }

    for (const key of [
      "structuredOutput",
      "structured_output",
      "structuredContent",
      "structured_content",
      "output",
      "finalOutput",
      "final_output",
      "enrichment",
      "report",
    ]) {
      const candidate = tryParseAuditEnrichment(record[key]);
      if (candidate) return candidate;
    }

    const turn = record.turn;
    if (turn && typeof turn === "object") {
      const fromTurn = extractAuditEnrichmentFromCodexTurnPayload(turn);
      if (fromTurn) return fromTurn;
    }

    const items = record.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const fromItem = extractAuditEnrichmentFromCodexTurnPayload(item);
        if (fromItem) return fromItem;
      }
    }
  }

  const strings: string[] = [];
  collectStrings(payload, strings);
  for (const text of strings) {
    const fromText = tryParseAuditEnrichmentJson(text);
    if (fromText) return fromText;
  }

  return null;
}
