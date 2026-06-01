import { describe, expect, it } from "vitest";
import { MacDiagnosticsAdapter } from "@/lib/adapter/mac-diagnostics/index";
import {
  extractRemoteAccessFindings,
  listenerUsesRemotelyReachablePort,
  parseCollectorEnabledState,
} from "@/lib/adapter/mac-diagnostics/remote-access";
import type { MacListeningSocket } from "@/lib/adapter/mac-diagnostics/listeners";

describe("mac remote access posture", () => {
  it("does not fail port checks for loopback-only remote-access listeners", () => {
    const sockets: MacListeningSocket[] = [
      { command: "ssh", address: "127.0.0.1", port: 22 },
    ];

    expect(listenerUsesRemotelyReachablePort(sockets, 22)).toBe(false);

    const findings = extractRemoteAccessFindings(
      {
        remote_login: "Off",
        remote_management: "Off",
      },
      sockets
    );
    const posture = findings[0];
    expect(posture?.severity_hint).toBe("low");
    expect(posture?.evidence).toContain("SSH (22/tcp) listener: pass");
    expect(posture?.evidence).toContain("loopback-only listener present");
  });

  it("parses raw systemsetup Remote Login output", () => {
    expect(parseCollectorEnabledState("Remote Login: On")).toBe("enabled");
    expect(parseCollectorEnabledState("Remote Login: Off")).toBe("disabled");
    expect(
      parseCollectorEnabledState(
        "You need administrator access to run systemsetup -getremotelogin"
      )
    ).toBe("admin_required");
  });

  it("flags enabled Remote Login from systemsetup when collector remote_login is absent", () => {
    const findings = extractRemoteAccessFindings(
      {
        remote_management: "Off",
        remote_login_systemsetup: "Remote Login: On",
      },
      []
    );

    expect(findings[0]?.severity_hint).toBe("high");
    expect(findings[0]?.evidence).toContain("Remote Login (systemsetup): fail");
  });

  it("keeps post-remediation fixture on administrator verification, not false SSH exposure", () => {
    const adapter = new MacDiagnosticsAdapter();
    const sections = adapter.parseSections(
      adapter.stripNoise(`=== mac-diagnostics ===
hostname: mac.local
os_name: macOS
os_version: 26.5
firewall_state: On
filevault_status: On
remote_login: Off
remote_management: Off
remote_login_systemsetup: You need administrator access to run systemsetup -getremotelogin
listening_tcp_json: [{"command":"node","address":"127.0.0.1","port":22}]
`)
    );
    const env = adapter.detectEnvironment(sections);
    const findings = adapter.extractPreFindings(sections, env);
    const posture = findings.find((finding) => finding.rule_id === "mac.remote_access_posture");

    expect(posture?.title).toContain("administrator verification");
    expect(posture?.evidence).toContain("SSH (22/tcp) listener: pass");
    expect(posture?.evidence).not.toContain("SSH (22/tcp) listener: fail");
  });
});
