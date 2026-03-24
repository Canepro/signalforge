/**
 * Optional Phase 5a ingestion envelope for POST /api/runs (JSON or multipart).
 * All fields are optional; omitted or empty strings are stored as null.
 */

export const INGESTION_META_FORM_KEYS = [
  "target_identifier",
  "source_label",
  "collector_type",
  "collector_version",
  "collected_at",
] as const;

const MAX_LEN = {
  target_identifier: 512,
  source_label: 512,
  collector_type: 256,
  collector_version: 128,
} as const;

export interface ParsedIngestionMeta {
  target_identifier: string | null;
  source_label: string | null;
  collector_type: string | null;
  collector_version: string | null;
  collected_at: string | null;
}

const EMPTY: ParsedIngestionMeta = {
  target_identifier: null,
  source_label: null,
  collector_type: null,
  collector_version: null,
  collected_at: null,
};

function optionalTrimmedString(
  value: unknown,
  maxLen: number,
  field: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const t = value.trim();
  if (t.length === 0) {
    return { ok: true, value: null };
  }
  if (t.length > maxLen) {
    return { ok: false, error: `${field} exceeds ${maxLen} characters` };
  }
  return { ok: true, value: t };
}

function optionalCollectedAt(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "collected_at must be a string (ISO 8601)" };
  }
  const t = value.trim();
  if (t.length === 0) {
    return { ok: true, value: null };
  }
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) {
    return { ok: false, error: "collected_at must be a valid ISO 8601 date-time" };
  }
  return { ok: true, value: new Date(ms).toISOString() };
}

/**
 * Parse optional ingestion metadata from JSON body fields or multipart form fields.
 */
export function parseIngestionMeta(
  input: Record<string, unknown>
): { ok: true; meta: ParsedIngestionMeta } | { ok: false; error: string } {
  const ti = optionalTrimmedString(
    input.target_identifier,
    MAX_LEN.target_identifier,
    "target_identifier"
  );
  if (!ti.ok) return ti;
  const sl = optionalTrimmedString(
    input.source_label,
    MAX_LEN.source_label,
    "source_label"
  );
  if (!sl.ok) return sl;
  const ct = optionalTrimmedString(
    input.collector_type,
    MAX_LEN.collector_type,
    "collector_type"
  );
  if (!ct.ok) return ct;
  const cv = optionalTrimmedString(
    input.collector_version,
    MAX_LEN.collector_version,
    "collector_version"
  );
  if (!cv.ok) return cv;
  const ca = optionalCollectedAt(input.collected_at);
  if (!ca.ok) return ca;

  const meta: ParsedIngestionMeta = {
    target_identifier: ti.value,
    source_label: sl.value,
    collector_type: ct.value,
    collector_version: cv.value,
    collected_at: ca.value,
  };

  const allEmpty =
    !meta.target_identifier &&
    !meta.source_label &&
    !meta.collector_type &&
    !meta.collector_version &&
    !meta.collected_at;

  if (allEmpty) {
    return { ok: true, meta: EMPTY };
  }

  return { ok: true, meta };
}

/** Build a record from multipart FormData for ingestion keys only. */
export function ingestionRecordFromFormData(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of INGESTION_META_FORM_KEYS) {
    const v = formData.get(key);
    if (v !== null && typeof v === "string") {
      out[key] = v;
    }
  }
  return out;
}
