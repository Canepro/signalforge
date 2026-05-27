export function parseMacBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "yes", "1", "on", "enabled"].includes(value.trim().toLowerCase());
}

export function parseMacInteger(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "none" || normalized === "--") {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMacFloat(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "none" || normalized === "--") {
    return null;
  }
  const stripped = normalized.endsWith("%") ? normalized.slice(0, -1).trim() : normalized;
  const parsed = Number.parseFloat(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMacJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function macValueFor(sections: Record<string, string>, key: string): string {
  return sections[key]?.trim() ?? "";
}

export function parseMacSections(clean: string): Record<string, string> {
  const sections: Record<string, string> = {};
  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("===")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase().replace(/\s+/g, "_");
    const value = trimmed.slice(idx + 1).trim();
    if (key) sections[key] = value;
  }
  return sections;
}
