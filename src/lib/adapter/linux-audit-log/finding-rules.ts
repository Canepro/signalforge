import type { EnvironmentContext, PreFinding } from "../../analyzer/schema";

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
  findings.push(...extractErrorFindings(sections, env));

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
      title: `${upgradableMatch[1]} packages pending upgrade`,
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
      title: `${aptListLines.length} packages pending upgrade`,
      severity_hint: "medium",
      category: "packages",
      section_source: "INSTALLED PACKAGES",
      evidence: aptListLines.slice(0, 3).join("; "),
      rule_id: "apt-upgradable-list",
    });
  }

  return results;
}

interface ParsedSocket {
  protocol: string;
  localAddr: string;
  port: number;
  rawLine: string;
  processName: string | null;
}

/**
 * Parse the Local Address:Port from an ss/netstat line.
 *
 * Handles two row layouts produced by `ss`:
 *   Full (Active Connections):  Netid State Recv-Q Send-Q Local:Port Peer:Port ...
 *   Short (Listening Services): State Recv-Q Send-Q Local:Port Peer:Port ...
 */
function parseSocketLine(line: string): ParsedSocket | null {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 5) return null;

  let localField: string | undefined;
  let protocol: string;

  if (fields[0] === "LISTEN") {
    localField = fields[3];
    protocol = "tcp";
  } else if (fields[1] === "LISTEN") {
    localField = fields[4];
    protocol = fields[0] ?? "tcp";
  } else {
    return null;
  }

  if (!localField) return null;

  const lastColon = localField.lastIndexOf(":");
  if (lastColon < 0) return null;

  const portStr = localField.substring(lastColon + 1);
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port <= 0) return null;

  const localAddr = localField.substring(0, lastColon);
  const processMatch = line.match(/users:\(\("([^"]+)"/);
  return {
    protocol,
    localAddr,
    port,
    rawLine: line,
    processName: processMatch?.[1] ?? null,
  };
}

function deduplicateSockets(sockets: ParsedSocket[]): ParsedSocket[] {
  const map = new Map<string, ParsedSocket>();
  for (const s of sockets) {
    const normAddr = s.localAddr.replace(/%\w+$/, "");
    const key = `${s.protocol}|${normAddr}|${s.port}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, s);
      continue;
    }
    // Active Connections and Listening Services often repeat the same socket; prefer
    // the row that includes `users:(("name",...))` for process identity.
    if (!existing.processName && s.processName) {
      map.set(key, s);
    }
  }
  return [...map.values()];
}

const WELL_KNOWN_SAFE_PORTS = new Set([22, 53]);
const OBSERVABILITY_PORTS = new Set([9090, 9100]);

type BindScope = "loopback" | "wildcard" | "specific";

function classifyBindScope(localAddr: string): BindScope {
  const addr = localAddr.replace(/^\[|\]$/g, "").replace(/%\w+$/, "").trim();
  if (
    addr === "*" ||
    addr === "0.0.0.0" ||
    addr === "::" ||
    addr === ":::" ||
    addr === "[::]"
  ) {
    return "wildcard";
  }
  if (addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.")) {
    return "loopback";
  }
  return "specific";
}

function isNodeProcess(processLower: string | undefined): boolean {
  return processLower === "node" || processLower === "nodejs";
}

/**
 * Human-readable service identity from bind address, port, and ss `users:(("name",...))` when present.
 * Stays conservative when process or role cannot be inferred.
 */
function serviceLabel(sock: ParsedSocket, bindScope: BindScope): string {
  const process = sock.processName?.toLowerCase() ?? "";
  const proc = process || undefined;

  if (proc?.includes("prometheus-node") || sock.port === 9100) {
    return "Prometheus node_exporter";
  }
  if ((proc?.includes("prometheus") && !proc.includes("prometheus-node")) || sock.port === 9090) {
    return "Prometheus server";
  }

  if (proc?.includes("nginx")) return "Nginx";
  if (proc?.includes("httpd") || proc?.includes("apache")) return "Apache httpd";
  if (proc?.includes("redis")) return "Redis";
  if (proc?.includes("postgres") || proc === "postmaster") return "PostgreSQL";
  if (proc?.includes("mongod")) return "MongoDB";

  if (isNodeProcess(proc)) {
    if (bindScope === "loopback") {
      return "Node.js (local-only; likely dev or tooling)";
    }
    return "Node.js";
  }

  if (sock.port === 80) return "HTTP listener (web)";
  if (sock.port === 443) return "HTTPS listener (TLS)";

  if (proc) {
    return `${proc} listener`;
  }
  return "Unidentified listener";
}

function buildListenerTitle(sock: ParsedSocket): string {
  const bindScope = classifyBindScope(sock.localAddr);
  const label = serviceLabel(sock, bindScope);
  if (bindScope === "loopback") {
    return `${label} listening on loopback only — not reachable remotely (port ${sock.port})`;
  }
  if (bindScope === "wildcard") {
    return `${label} reachable on all network interfaces (port ${sock.port})`;
  }
  return `${label} bound to ${sock.localAddr} (port ${sock.port})`;
}

function listenerSeverity(sock: ParsedSocket, env: EnvironmentContext): "medium" | "low" {
  const bindScope = classifyBindScope(sock.localAddr);
  if (bindScope === "loopback") return "low";
  if (env.is_wsl && OBSERVABILITY_PORTS.has(sock.port)) return "low";
  if (env.is_wsl) return "low";
  return "medium";
}

function extractListeningServices(
  sections: Record<string, string>,
  env: EnvironmentContext
): PreFinding[] {
  const network = sections["NETWORK CONFIGURATION"] ?? "";
  const lines = network.split("\n").filter((l) => l.includes("LISTEN"));

  const parsed = lines
    .map(parseSocketLine)
    .filter((s): s is ParsedSocket => s !== null);

  const unique = deduplicateSockets(parsed);
  const results: PreFinding[] = [];

  for (const sock of unique) {
    if (WELL_KNOWN_SAFE_PORTS.has(sock.port)) continue;

    const severity = listenerSeverity(sock, env);
    results.push({
      title: buildListenerTitle(sock),
      severity_hint: severity,
      category: "network",
      section_source: "NETWORK CONFIGURATION",
      evidence: sock.rawLine.trim(),
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

function extractErrorFindings(
  sections: Record<string, string>,
  env: EnvironmentContext
): PreFinding[] {
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
        !l.includes("pam_lastlog") &&
        !l.includes("Process error reports when automatic reporting is enabled") &&
        !l.includes("ConditionPathExists=/var/lib/apport/autoreport") &&
        !(env.is_wsl && l.includes("skipped because of an unmet condition check"))
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
