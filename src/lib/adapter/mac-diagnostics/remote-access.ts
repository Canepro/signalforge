import type { PreFinding } from "../../analyzer/schema";
import { parseMacJson } from "./parse";
import type { MacListeningSocket } from "./listeners";

export type RemoteAccessCheckStatus = "pass" | "fail" | "not_verified" | "not_applicable";

export type RemoteAccessCheck = {
  id?: string;
  label: string;
  status: RemoteAccessCheckStatus;
  detail?: string | null;
};

export type RemoteAccessPosture = {
  checks?: RemoteAccessCheck[];
  summary?: string | null;
};

const REMOTE_ACCESS_PORTS: Array<{ port: number; label: string }> = [
  { port: 22, label: "SSH (22/tcp)" },
  { port: 139, label: "SMB NetBIOS (139/tcp)" },
  { port: 445, label: "SMB (445/tcp)" },
  { port: 548, label: "AFP (548/tcp)" },
  { port: 3283, label: "ARD (3283/tcp)" },
  { port: 5900, label: "VNC/Screen Sharing (5900/tcp)" },
];

function stateIsEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["on", "enabled", "true", "yes", "1"].includes(normalized);
}

function listenerUsesPort(sockets: MacListeningSocket[], port: number): boolean {
  return sockets.some((socket) => Number.parseInt(String(socket.port ?? ""), 10) === port);
}

function summarizeChecks(checks: RemoteAccessCheck[]): string {
  return checks
    .map((check) => {
      const detail = check.detail ? ` (${check.detail})` : "";
      return `${check.label}: ${check.status.replace(/_/g, " ")}${detail}`;
    })
    .join("; ");
}

function postureSeverity(checks: RemoteAccessCheck[]): "medium" | "high" | "low" {
  if (checks.some((check) => check.status === "fail")) return "high";
  if (checks.some((check) => check.status === "not_verified")) return "medium";
  return "low";
}

function buildPostureTitle(checks: RemoteAccessCheck[]): string {
  const failed = checks.filter((check) => check.status === "fail");
  const unverified = checks.filter((check) => check.status === "not_verified");

  if (failed.length > 0) {
    return `Remote access posture: ${failed.length} check${failed.length === 1 ? "" : "s"} indicate exposure`;
  }
  if (unverified.length > 0) {
    return `Remote access posture: core checks passed; ${unverified.length} item${unverified.length === 1 ? "" : "s"} require administrator verification`;
  }
  return "Remote access posture: no remote access listeners or services observed";
}

function synthesizeChecksFromSections(
  sections: Record<string, string>,
  sockets: MacListeningSocket[]
): RemoteAccessCheck[] {
  const checks: RemoteAccessCheck[] = [];

  for (const { port, label } of REMOTE_ACCESS_PORTS) {
    const present = listenerUsesPort(sockets, port);
    checks.push({
      id: `listener_${port}`,
      label: `${label} listener`,
      status: present ? "fail" : "pass",
      detail: present ? "listener present" : "no listener observed",
    });
  }

  const remoteLogin = sections.remote_login?.trim() ?? "";
  if (remoteLogin) {
    checks.push({
      id: "remote_login",
      label: "Remote Login (collector)",
      status: stateIsEnabled(remoteLogin) ? "fail" : "pass",
      detail: remoteLogin,
    });
  } else {
    checks.push({
      id: "remote_login",
      label: "Remote Login (collector)",
      status: "not_verified",
      detail: "not collected",
    });
  }

  const remoteManagement = sections.remote_management?.trim() ?? "";
  if (remoteManagement) {
    checks.push({
      id: "remote_management",
      label: "Remote Management (collector)",
      status: stateIsEnabled(remoteManagement) ? "fail" : "pass",
      detail: remoteManagement,
    });
  }

  const screenSharingLaunchctl = sections.screen_sharing_launchctl?.trim() ?? "";
  if (screenSharingLaunchctl) {
    checks.push({
      id: "screen_sharing_launchctl",
      label: "Screen Sharing launchd service",
      status: /not found|could not find/i.test(screenSharingLaunchctl) ? "pass" : "fail",
      detail: screenSharingLaunchctl,
    });
  }

  const remoteLoginSystemsetup = sections.remote_login_systemsetup?.trim() ?? "";
  if (remoteLoginSystemsetup) {
    const needsAdmin = /administrator|admin access|requires root/i.test(remoteLoginSystemsetup);
    checks.push({
      id: "remote_login_systemsetup",
      label: "Remote Login (systemsetup)",
      status: needsAdmin
        ? "not_verified"
        : stateIsEnabled(remoteLoginSystemsetup)
          ? "fail"
          : "pass",
      detail: remoteLoginSystemsetup,
    });
  }

  const preferenceChecks: Array<{ key: string; label: string }> = [
    { key: "remote_management_plist", label: "Remote Management preferences plist" },
    { key: "screen_sharing_plist", label: "Screen Sharing preferences plist" },
    { key: "vnc_settings_txt", label: "VNC settings file" },
  ];

  for (const { key, label } of preferenceChecks) {
    const value = sections[key]?.trim();
    if (!value) continue;
    const missing = /not found|no such file|missing/i.test(value);
    checks.push({
      id: key,
      label,
      status: missing ? "pass" : "fail",
      detail: value,
    });
  }

  return checks;
}

export function extractRemoteAccessFindings(
  sections: Record<string, string>,
  sockets: MacListeningSocket[]
): PreFinding[] {
  const parsedPosture = parseMacJson<RemoteAccessPosture>(sections.remote_access_posture_json);
  const checks =
    Array.isArray(parsedPosture?.checks) && parsedPosture!.checks!.length > 0
      ? parsedPosture!.checks!.filter((check) => check?.label && check?.status)
      : synthesizeChecksFromSections(sections, sockets);

  if (checks.length === 0) return [];

  const hasFail = checks.some((check) => check.status === "fail");
  const hasUnverified = checks.some((check) => check.status === "not_verified");

  return [
    {
      title: buildPostureTitle(checks),
      severity_hint: hasFail || hasUnverified ? postureSeverity(checks) : "low",
      category: "network",
      section_source: parsedPosture ? "remote_access_posture_json" : "listening_tcp_json",
      evidence: parsedPosture?.summary
        ? `${parsedPosture.summary} | ${summarizeChecks(checks)}`
        : summarizeChecks(checks),
      rule_id: "mac.remote_access_posture",
    },
  ];
}
