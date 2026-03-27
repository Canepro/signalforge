export function parseContainerBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "yes", "1", "on"].includes(value.trim().toLowerCase());
}

export function parseContainerInteger(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "none" || normalized === "--") {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseContainerFloat(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "none" || normalized === "--") {
    return null;
  }
  const stripped = normalized.endsWith("%") ? normalized.slice(0, -1).trim() : normalized;
  const parsed = Number.parseFloat(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseContainerList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.toLowerCase() !== "none");
}

export function containerValueFor(sections: Record<string, string>, key: string): string {
  return sections[key]?.trim() ?? "";
}

export function parseContainerSections(clean: string): Record<string, string> {
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
