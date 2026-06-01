import type { PreFinding } from "../../analyzer/schema";
import { parseMacJson } from "./parse";

export type MacFileShare = {
  name?: string | null;
  protocol?: string | null;
  guest_access?: boolean | string | null;
  listener_active?: boolean | string | null;
  path?: string | null;
};

function guestAccessEnabled(share: MacFileShare): boolean {
  if (share.guest_access === true) return true;
  const normalized = String(share.guest_access ?? "").trim().toLowerCase();
  return ["true", "yes", "on", "enabled", "1"].includes(normalized);
}

function listenerActive(share: MacFileShare): boolean {
  if (share.listener_active === true) return true;
  const normalized = String(share.listener_active ?? "").trim().toLowerCase();
  return ["true", "yes", "on", "active", "listening", "1"].includes(normalized);
}

export function extractFileSharingFindings(sections: Record<string, string>): PreFinding[] {
  const parsedShares = parseMacJson<MacFileShare[]>(sections.file_sharing_json);
  if (!Array.isArray(parsedShares) || parsedShares.length === 0) return [];

  const findings: PreFinding[] = [];

  for (const share of parsedShares) {
    const protocol = String(share.protocol ?? "share").trim().toLowerCase();
    const name = String(share.name ?? "unnamed share").trim() || "unnamed share";
    const guest = guestAccessEnabled(share);
    const active = listenerActive(share);

    if (!guest) continue;

    if (active) {
      findings.push({
        title: `${protocol.toUpperCase()} share "${name}" allows guest access with an active listener`,
        severity_hint: "high",
        category: "network",
        section_source: "file_sharing_json",
        evidence: JSON.stringify(share),
        rule_id: "mac.file_sharing_guest_active",
      });
      continue;
    }

    findings.push({
      title: `${protocol.toUpperCase()} share "${name}" allows guest access but no listener is active (configured, not listening)`,
      severity_hint: "medium",
      category: "network",
      section_source: "file_sharing_json",
      evidence: JSON.stringify(share),
      rule_id: "mac.file_sharing_guest_inactive",
    });
  }

  return findings;
}
