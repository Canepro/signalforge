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
  for (const candidate of jsonObjectCandidates(text)) {
    try {
      const parsed = tryParseAuditReport(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Keep scanning later candidates; app-server text may contain prose before JSON.
    }
  }
  return null;
}

function tryParseAuditEnrichmentJson(text: string): AuditEnrichment | null {
  for (const candidate of jsonObjectCandidates(text)) {
    try {
      const parsed = tryParseAuditEnrichment(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Keep scanning later candidates; app-server text may contain prose before JSON.
    }
  }
  return null;
}

function jsonObjectCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith("{")) candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim().startsWith("{")) {
    candidates.push(fenced[1].trim());
  }

  for (const objectText of balancedJsonObjects(trimmed)) {
    if (!candidates.includes(objectText)) candidates.push(objectText);
  }

  return candidates;
}

function balancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return out;
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

    const notifications = record.notifications;
    if (Array.isArray(notifications)) {
      for (const notification of notifications) {
        const fromNotification = extractAuditReportFromCodexTurnPayload(notification);
        if (fromNotification) return fromNotification;
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

    const notifications = record.notifications;
    if (Array.isArray(notifications)) {
      for (const notification of notifications) {
        const fromNotification = extractAuditEnrichmentFromCodexTurnPayload(notification);
        if (fromNotification) return fromNotification;
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
