import type { EnvironmentContext, PreFinding } from "../../analyzer/schema.js";

let findingCounter = 0;
function nextId(): string {
  findingCounter++;
  return `PF${String(findingCounter).padStart(3, "0")}`;
}

export function resetFindingCounter(): void {
  findingCounter = 0;
}

export function extractPreFindings(
  sections: Record<string, string>,
  env: EnvironmentContext
): PreFinding[] {
  resetFindingCounter();
  const findings: PreFinding[] = [];

  findings.push(...extractDiskFindings(sections));
  findings.push(...extractPackageFindings(sections));
  findings.push(...extractListeningServices(sections, env));
  findings.push(...extractSshFindings(sections));
  findings.push(...extractAuthFindings(sections));
  findings.push(...extractErrorFindings(sections));

  return findings;
}

function extractDiskFindings(sections: Record<string, string>): PreFinding[] {
  const disk = sections["DISK & MEMORY USAGE"] ?? "";
  const results: PreFinding[] = [];

  const dfLines = disk.split("\n").filter(
    (l) =>
      (l.startsWith("/") || l.includes("/mnt/") || l.match(/^[A-Z]:\\/)) &&
      !l.includes("snapfuse") &&
      !l.includes("/snap/")
  );
  for (const line of dfLines) {
    const match = line.match(/(\d+)%/);
    if (!match) continue;
    const usage = parseInt(match[1], 10);
    const fs = line.split(/\s+/)[0] ?? "unknown";

    if (usage >= 90) {
      results.push({
        title: `Disk usage critical: ${fs} at ${usage}%`,
        severity_hint: "high",
        category: "disk",
        section_source: "DISK & MEMORY USAGE",
        evidence: line.trim(),
        rule_id: "disk-critical",
      });
    } else if (usage >= 85) {
      results.push({
        title: `Disk usage warning: ${fs} at ${usage}%`,
        severity_hint: "medium",
        category: "disk",
        section_source: "DISK & MEMORY USAGE",
        evidence: line.trim(),
        rule_id: "disk-warning",
      });
    }
  }

  return results;
}

function extractPackageFindings(
  sections: Record<string, string>
): PreFinding[] {
  const packages = sections["INSTALLED PACKAGES"] ?? "";
  const results: PreFinding[] = [];

  const upgradableMatch = packages.match(
    /(\d+)\s+packages?\s+can\s+be\s+upgraded/i
  );
  if (upgradableMatch) {
    results.push({
      title: `${upgradableMatch[1]} packages can be upgraded`,
      severity_hint: "medium",
      category: "packages",
      section_source: "INSTALLED PACKAGES",
      evidence: upgradableMatch[0],
      rule_id: "apt-upgradable-count",
    });
  }

  const upgradableLines = packages
    .split("\n")
    .filter((l) => l.includes("upgradable from") || l.includes("/"));
  const aptListLines = upgradableLines.filter(
    (l) => l.includes("upgradable") && !l.includes("Listing")
  );
  if (aptListLines.length > 0 && !upgradableMatch) {
    results.push({
      title: `${aptListLines.length} packages available for upgrade`,
      severity_hint: "medium",
      category: "packages",
      section_source: "INSTALLED PACKAGES",
      evidence: aptListLines.slice(0, 3).join("; "),
      rule_id: "apt-upgradable-list",
    });
  }

  return results;
}

function extractListeningServices(
  sections: Record<string, string>,
  env: EnvironmentContext
): PreFinding[] {
  const network = sections["NETWORK CONFIGURATION"] ?? "";
  const results: PreFinding[] = [];

  const listenLines = network
    .split("\n")
    .filter(
      (l) =>
        l.includes("LISTEN") ||
        (l.includes("0.0.0.0:") && !l.includes("127."))
    );

  const portPattern = /[:\s](\d{2,5})\s/;
  const wellKnownSafe = new Set(["53", "22"]);

  for (const line of listenLines) {
    const portMatch = line.match(portPattern);
    if (!portMatch) continue;
    const port = portMatch[1];
    if (wellKnownSafe.has(port)) continue;

    const severity = env.is_wsl ? "low" : "medium";
    results.push({
      title: `Service listening on port ${port}`,
      severity_hint: severity,
      category: "network",
      section_source: "NETWORK CONFIGURATION",
      evidence: line.trim(),
      rule_id: "listening-service",
    });
  }

  return results;
}

function extractSshFindings(sections: Record<string, string>): PreFinding[] {
  const ssh = sections["SSH CONFIGURATION"] ?? "";
  const results: PreFinding[] = [];

  if (/PermitRootLogin\s+yes/i.test(ssh)) {
    results.push({
      title: "SSH permits root login",
      severity_hint: "medium",
      category: "ssh",
      section_source: "SSH CONFIGURATION",
      evidence: "PermitRootLogin yes",
      rule_id: "ssh-root-login",
    });
  }

  if (/PasswordAuthentication\s+yes/i.test(ssh)) {
    results.push({
      title: "SSH password authentication enabled",
      severity_hint: "medium",
      category: "ssh",
      section_source: "SSH CONFIGURATION",
      evidence: "PasswordAuthentication yes",
      rule_id: "ssh-password-auth",
    });
  }

  return results;
}

function extractAuthFindings(sections: Record<string, string>): PreFinding[] {
  const errors = sections["RECENT ERRORS & LOGS"] ?? "";
  const results: PreFinding[] = [];

  const failedAuthLines = errors
    .split("\n")
    .filter(
      (l) =>
        l.includes("Failed password") ||
        l.includes("authentication failure") ||
        l.includes("FAILED LOGIN")
    );

  if (failedAuthLines.length >= 5) {
    results.push({
      title: `${failedAuthLines.length} failed authentication attempts detected`,
      severity_hint: "high",
      category: "auth",
      section_source: "RECENT ERRORS & LOGS",
      evidence: failedAuthLines.slice(0, 3).join("\n"),
      rule_id: "auth-failed-multiple",
    });
  }

  return results;
}

function extractErrorFindings(sections: Record<string, string>): PreFinding[] {
  const errors = sections["RECENT ERRORS & LOGS"] ?? "";
  const results: PreFinding[] = [];

  const errorLines = errors
    .split("\n")
    .filter(
      (l) =>
        l.toLowerCase().includes("error") &&
        !l.includes("getaddrinfo") &&
        !l.includes("dxgkio") &&
        !l.includes("WaitForBootProcess") &&
        !l.includes("wsl-pro-service") &&
        !l.includes("nvmf-autoconnect") &&
        !l.includes("openipmi") &&
        !l.includes("systemd-tmpfiles") &&
        !l.includes("pam_lastlog")
    );

  if (errorLines.length > 10) {
    results.push({
      title: `${errorLines.length} non-trivial errors in recent logs`,
      severity_hint: "medium",
      category: "logs",
      section_source: "RECENT ERRORS & LOGS",
      evidence: errorLines.slice(0, 3).join("\n"),
      rule_id: "error-count-high",
    });
  }

  return results;
}
