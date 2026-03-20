const DELIMITER = /^[━]{3,}$/;
const SECTION_HEADER = /^\[(.+)\]$/;

export const KNOWN_SECTIONS = [
  "SYSTEM IDENTITY",
  "NETWORK CONFIGURATION",
  "USER ACCOUNTS",
  "SSH CONFIGURATION",
  "FIREWALL & SECURITY",
  "INSTALLED PACKAGES",
  "DISK & MEMORY USAGE",
  "RUNNING SERVICES",
  "RECENT ERRORS & LOGS",
] as const;

export type SectionName = (typeof KNOWN_SECTIONS)[number];

export function parseSections(text: string): Record<string, string> {
  const lines = text.split("\n");
  const sections: Record<string, string> = {};
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (DELIMITER.test(line)) {
      if (currentSection && currentLines.length > 0) {
        sections[currentSection] = currentLines.join("\n").trim();
      }

      const nextLine = lines[i + 1]?.trim();
      if (nextLine) {
        const headerMatch = nextLine.match(SECTION_HEADER);
        if (headerMatch) {
          currentSection = headerMatch[1];
          currentLines = [];
          i += 2; // skip header and next delimiter
          continue;
        }
      }

      if (currentSection) {
        sections[currentSection] = currentLines.join("\n").trim();
        currentSection = null;
        currentLines = [];
      }
      continue;
    }

    if (currentSection) {
      currentLines.push(lines[i]);
    }
  }

  if (currentSection && currentLines.length > 0) {
    sections[currentSection] = currentLines.join("\n").trim();
  }

  return sections;
}
