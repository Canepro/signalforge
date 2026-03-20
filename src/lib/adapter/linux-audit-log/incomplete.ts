import { KNOWN_SECTIONS } from "./sections.js";

export function detectIncomplete(sections: Record<string, string>): {
  incomplete: boolean;
  reason?: string;
} {
  const foundSections = Object.keys(sections);
  const expectedCount = KNOWN_SECTIONS.length; // 9

  if (foundSections.length === 0) {
    return {
      incomplete: true,
      reason: "No recognizable sections found in the audit log",
    };
  }

  if (foundSections.length < expectedCount / 2) {
    const missing = KNOWN_SECTIONS.filter((s) => !sections[s]);
    return {
      incomplete: true,
      reason: `Only ${foundSections.length} of ${expectedCount} expected sections found. Missing: ${missing.join(", ")}`,
    };
  }

  if (!sections["SYSTEM IDENTITY"]) {
    return {
      incomplete: true,
      reason: "SYSTEM IDENTITY section is missing",
    };
  }

  const identity = sections["SYSTEM IDENTITY"];
  if (identity.length < 50) {
    return {
      incomplete: true,
      reason: "SYSTEM IDENTITY section appears truncated",
    };
  }

  return { incomplete: false };
}
