import type { ArtifactAdapter } from "../types";
import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema";
import {
  macValueFor,
  parseMacBoolean,
  parseMacFloat,
  parseMacInteger,
  parseMacJson,
  parseMacSections,
} from "./parse";

type ListeningSocket = {
  command?: string | null;
  pid?: number | string | null;
  user?: string | null;
  protocol?: string | null;
  address?: string | null;
  port?: number | string | null;
};

function stateIsDisabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["off", "disabled", "false", "no", "0"].includes(normalized);
}

function stateIsEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["on", "enabled", "true", "yes", "1"].includes(normalized);
}

function severityForOpenPorts(sockets: ListeningSocket[]): "medium" | "high" {
  const publicListeners = sockets.filter((socket) => {
    const address = String(socket.address ?? "").trim();
    return address && !address.startsWith("127.") && address !== "::1" && address !== "localhost";
  });
  return publicListeners.length > 0 ? "high" : "medium";
}

export class MacDiagnosticsAdapter implements ArtifactAdapter {
  readonly type = "mac-diagnostics";

  stripNoise(raw: string): string {
    return raw.replace(/\r\n/g, "\n").trim();
  }

  parseSections(clean: string): Record<string, string> {
    return parseMacSections(clean);
  }

  detectEnvironment(sections: Record<string, string>): EnvironmentContext {
    const osName = macValueFor(sections, "os_name") || "macOS";
    const osVersion = macValueFor(sections, "os_version");
    const buildVersion = macValueFor(sections, "build_version");
    const os = [osName, osVersion, buildVersion ? `(${buildVersion})` : ""]
      .filter(Boolean)
      .join(" ");
    return {
      hostname: macValueFor(sections, "hostname") || "unknown-mac",
      os,
      kernel: macValueFor(sections, "kernel") || macValueFor(sections, "darwin_version") || "unknown",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: parseMacBoolean(sections.ran_as_root),
      uptime: macValueFor(sections, "uptime") || "unknown",
    };
  }

  classifyNoise(sections: Record<string, string>, env: EnvironmentContext): NoiseItem[] {
    const noise: NoiseItem[] = [];
    if (!env.ran_as_root) {
      noise.push({
        observation: "Mac diagnostics collected without root privileges",
        reason_expected:
          "Some protected launch, security, and network details require elevated macOS privileges",
        related_environment: "non-root macOS",
      });
    }
    if (macValueFor(sections, "mdm_enrollment") === "unknown") {
      noise.push({
        observation: "MDM enrollment state unavailable",
        reason_expected:
          "The collector could not read mobile device management state from this account",
        related_environment: "macOS",
      });
    }
    return noise;
  }

  extractPreFindings(sections: Record<string, string>, _env: EnvironmentContext): PreFinding[] {
    const findings: PreFinding[] = [];
    const firewallState = macValueFor(sections, "firewall_state");
    const filevaultState = macValueFor(sections, "filevault_status");
    const sipState = macValueFor(sections, "sip_status");
    const remoteLogin = macValueFor(sections, "remote_login");
    const remoteManagement = macValueFor(sections, "remote_management");
    const stealthMode = macValueFor(sections, "stealth_mode");
    const diskUsedPercent = parseMacFloat(sections.disk_root_used_percent);
    const brewOutdated = parseMacInteger(sections.brew_outdated_count);
    const parsedSockets = parseMacJson<unknown>(sections.listening_tcp_json);
    const sockets: ListeningSocket[] = Array.isArray(parsedSockets)
      ? (parsedSockets as ListeningSocket[])
      : [];

    if (firewallState && stateIsDisabled(firewallState)) {
      findings.push({
        title: "macOS application firewall is disabled",
        severity_hint: "medium",
        category: "network",
        section_source: "firewall_state",
        evidence: firewallState,
        rule_id: "mac.firewall_disabled",
      });
    }

    if (filevaultState && stateIsDisabled(filevaultState)) {
      findings.push({
        title: "FileVault disk encryption is disabled",
        severity_hint: "high",
        category: "security",
        section_source: "filevault_status",
        evidence: filevaultState,
        rule_id: "mac.filevault_disabled",
      });
    }

    if (sipState && /disabled/i.test(sipState)) {
      findings.push({
        title: "System Integrity Protection is disabled",
        severity_hint: "high",
        category: "security",
        section_source: "sip_status",
        evidence: sipState,
        rule_id: "mac.sip_disabled",
      });
    }

    if (remoteLogin && stateIsEnabled(remoteLogin)) {
      findings.push({
        title: "Remote Login is enabled",
        severity_hint: "medium",
        category: "network",
        section_source: "remote_login",
        evidence: remoteLogin,
        rule_id: "mac.remote_login_enabled",
      });
    }

    if (remoteManagement && stateIsEnabled(remoteManagement)) {
      findings.push({
        title: "Remote Management is enabled",
        severity_hint: "high",
        category: "network",
        section_source: "remote_management",
        evidence: remoteManagement,
        rule_id: "mac.remote_management_enabled",
      });
    }

    if (stealthMode && stateIsDisabled(stealthMode) && firewallState && stateIsEnabled(firewallState)) {
      findings.push({
        title: "Firewall stealth mode is disabled",
        severity_hint: "low",
        category: "network",
        section_source: "stealth_mode",
        evidence: stealthMode,
        rule_id: "mac.stealth_mode_disabled",
      });
    }

    if (sockets.length > 0) {
      findings.push({
        title: `Mac has ${sockets.length} listening TCP service${sockets.length === 1 ? "" : "s"}`,
        severity_hint: severityForOpenPorts(sockets),
        category: "network",
        section_source: "listening_tcp_json",
        evidence: JSON.stringify(sockets.slice(0, 8)),
        rule_id: "mac.listening_tcp_services",
      });
    }

    if (diskUsedPercent !== null && diskUsedPercent >= 85) {
      findings.push({
        title: `Mac root volume usage is elevated (${diskUsedPercent.toFixed(1)}%)`,
        severity_hint: diskUsedPercent >= 95 ? "high" : "medium",
        category: "resource",
        section_source: "disk_root_used_percent",
        evidence: sections.disk_root_used_percent ?? String(diskUsedPercent),
        rule_id: "mac.disk_pressure",
      });
    }

    if (brewOutdated !== null && brewOutdated > 0) {
      findings.push({
        title: `${brewOutdated} Homebrew package${brewOutdated === 1 ? "" : "s"} pending upgrade`,
        severity_hint: brewOutdated >= 20 ? "medium" : "low",
        category: "security",
        section_source: "brew_outdated_count",
        evidence: sections.brew_outdated_count ?? String(brewOutdated),
        rule_id: "mac.homebrew_outdated",
      });
    }

    return findings;
  }

  detectIncomplete(sections: Record<string, string>): { incomplete: boolean; reason?: string } {
    const required = ["hostname", "os_name", "os_version", "firewall_state", "filevault_status"];
    const missing = required.filter((key) => !macValueFor(sections, key));
    if (missing.length > 0) {
      return {
        incomplete: true,
        reason: `Missing required macOS diagnostic fields: ${missing.join(", ")}`,
      };
    }
    return { incomplete: false };
  }
}
