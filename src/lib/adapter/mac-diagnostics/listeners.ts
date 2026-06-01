import type { PreFinding } from "../../analyzer/schema";

export type MacListeningSocket = {
  command?: string | null;
  pid?: number | string | null;
  user?: string | null;
  protocol?: string | null;
  address?: string | null;
  port?: number | string | null;
  executable?: string | null;
  signed_by?: string | null;
  signing_authority?: string | null;
  apple_signed?: boolean | string | null;
};

export type ListenerBucket = "apple_continuity" | "local_dev" | "unknown_unsigned";

const APPLE_CONTINUITY_COMMANDS = new Set([
  "rapportd",
  "controlcenter",
  "sharingd",
  "identityservicesd",
  "airplayd",
]);

const LOCAL_DEV_COMMAND_PATTERNS = [
  /^node$/i,
  /^nodejs$/i,
  /^gvproxy$/i,
  /^podman$/i,
  /^docker-proxy$/i,
  /^com\.docker\./i,
  /^python\d*$/i,
  /^ruby$/i,
  /^bun$/i,
  /^php$/i,
  /^java$/i,
  /^postgres$/i,
  /^mysqld$/i,
  /^redis-server$/i,
];

const LOCAL_DEV_PORTS = new Set([3000, 3001, 5173, 5432, 5433, 8000, 8080, 8443, 9229]);

function commandName(socket: MacListeningSocket): string {
  return String(socket.command ?? "")
    .trim()
    .toLowerCase();
}

function executablePath(socket: MacListeningSocket): string {
  return String(socket.executable ?? "").trim();
}

function signingText(socket: MacListeningSocket): string {
  return [socket.signed_by, socket.signing_authority]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isWildcardBind(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").trim().toLowerCase();
  return (
    normalized === "*" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]" ||
    normalized === ":::"
  );
}

export function isLoopbackBind(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost" ||
    normalized.startsWith("127.")
  );
}

function parsePort(socket: MacListeningSocket): number | null {
  const raw = socket.port;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAppleSigned(socket: MacListeningSocket): boolean {
  if (socket.apple_signed === true) return true;
  if (String(socket.apple_signed ?? "").trim().toLowerCase() === "true") return true;
  const signing = signingText(socket);
  return (
    signing.includes("apple software signing") ||
    signing.includes("apple code signing") ||
    signing.includes("apple inc")
  );
}

function isAppleSystemPath(executable: string): boolean {
  return (
    executable.startsWith("/usr/libexec/") ||
    executable.startsWith("/system/library/") ||
    executable.startsWith("/system/applications/")
  );
}

function isAppleContinuityService(socket: MacListeningSocket): boolean {
  const command = commandName(socket);
  if (APPLE_CONTINUITY_COMMANDS.has(command)) return true;

  const executable = executablePath(socket).toLowerCase();
  if (
    executable.includes("/usr/libexec/rapportd") ||
    executable.includes("controlcenter.app/") ||
    executable.includes("/system/library/coreservices/controlcenter.app/")
  ) {
    return true;
  }

  return isAppleSigned(socket) && isAppleSystemPath(executable);
}

function isLocalDevService(socket: MacListeningSocket): boolean {
  const command = commandName(socket);
  if (LOCAL_DEV_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    return true;
  }

  const path = executablePath(socket).toLowerCase();
  if (
    path.includes("/node_modules/") ||
    path.includes("/.nvm/") ||
    path.includes("/homebrew/") ||
    path.includes("/opt/homebrew/") ||
    path.includes("gvproxy") ||
    path.includes("podman")
  ) {
    return true;
  }

  const port = parsePort(socket);
  return port !== null && LOCAL_DEV_PORTS.has(port);
}

export function classifyListenerBucket(
  socket: MacListeningSocket
): ListenerBucket | "loopback" | "non_wildcard" {
  const address = String(socket.address ?? "").trim();
  if (!address) return "non_wildcard";
  if (isLoopbackBind(address)) return "loopback";
  if (!isWildcardBind(address)) return "non_wildcard";
  if (isAppleContinuityService(socket)) return "apple_continuity";
  if (isLocalDevService(socket)) return "local_dev";
  return "unknown_unsigned";
}

function formatSocketSummary(socket: MacListeningSocket): string {
  const command = String(socket.command ?? "unknown").trim() || "unknown";
  const address = String(socket.address ?? "*").trim() || "*";
  const port = socket.port ?? "?";
  return `${command} ${address}:${port}`;
}

function bucketSeverity(bucket: ListenerBucket, count: number): "low" | "medium" | "high" {
  if (bucket === "apple_continuity") return count > 2 ? "medium" : "low";
  if (bucket === "local_dev") return "high";
  return "high";
}

function bucketTitle(bucket: ListenerBucket, sockets: MacListeningSocket[]): string {
  const labels = sockets.map((socket) => formatSocketSummary(socket));
  const joined = labels.slice(0, 4).join("; ");
  const suffix = labels.length > 4 ? ` (+${labels.length - 4} more)` : "";

  if (bucket === "apple_continuity") {
    return `Apple continuity/AirPlay listeners on all interfaces (${joined}${suffix})`;
  }
  if (bucket === "local_dev") {
    return `Local development listeners on all interfaces (${joined}${suffix})`;
  }
  return `Unsigned or unclassified listeners on all interfaces (${joined}${suffix})`;
}

function bucketEvidence(bucket: ListenerBucket, sockets: MacListeningSocket[]): string {
  return JSON.stringify({
    bucket,
    listeners: sockets.slice(0, 8).map((socket) => ({
      command: socket.command ?? null,
      address: socket.address ?? null,
      port: socket.port ?? null,
      executable: socket.executable ?? null,
      signed_by: socket.signed_by ?? socket.signing_authority ?? null,
    })),
  });
}

function bucketRuleId(bucket: ListenerBucket): string {
  if (bucket === "apple_continuity") return "mac.wildcard_listeners_apple_continuity";
  if (bucket === "local_dev") return "mac.wildcard_listeners_local_dev";
  return "mac.wildcard_listeners_unknown";
}

export function extractWildcardListenerFindings(sockets: MacListeningSocket[]): PreFinding[] {
  const buckets: Record<ListenerBucket, MacListeningSocket[]> = {
    apple_continuity: [],
    local_dev: [],
    unknown_unsigned: [],
  };

  for (const socket of sockets) {
    const bucket = classifyListenerBucket(socket);
    if (bucket === "apple_continuity" || bucket === "local_dev" || bucket === "unknown_unsigned") {
      buckets[bucket].push(socket);
    }
  }

  const findings: PreFinding[] = [];
  for (const bucket of Object.keys(buckets) as ListenerBucket[]) {
    const grouped = buckets[bucket];
    if (grouped.length === 0) continue;

    findings.push({
      title: bucketTitle(bucket, grouped),
      severity_hint: bucketSeverity(bucket, grouped.length),
      category: "network",
      section_source: "listening_tcp_json",
      evidence: bucketEvidence(bucket, grouped),
      rule_id: bucketRuleId(bucket),
    });
  }

  return findings;
}

export function extractLoopbackDevListenerFindings(sockets: MacListeningSocket[]): PreFinding[] {
  const loopbackDev = sockets.filter((socket) => {
    const bucket = classifyListenerBucket(socket);
    return bucket === "loopback" && isLocalDevService(socket);
  });
  if (loopbackDev.length === 0) return [];

  return [
    {
      title: `Local development listeners on loopback only (${loopbackDev
        .map((socket) => formatSocketSummary(socket))
        .slice(0, 4)
        .join("; ")})`,
      severity_hint: "low",
      category: "network",
      section_source: "listening_tcp_json",
      evidence: bucketEvidence("local_dev", loopbackDev),
      rule_id: "mac.loopback_local_dev_listeners",
    },
  ];
}
