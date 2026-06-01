import { describe, expect, it } from "vitest";
import {
  classifyListenerBucket,
  extractWildcardListenerFindings,
  type MacListeningSocket,
} from "@/lib/adapter/mac-diagnostics/listeners";

describe("mac listener bucketing", () => {
  it("classifies Apple continuity wildcard listeners separately from dev servers", () => {
    const sockets: MacListeningSocket[] = [
      {
        command: "rapportd",
        address: "*",
        port: 55718,
        executable: "/usr/libexec/rapportd",
        signing_authority: "Apple Software Signing",
      },
      {
        command: "ControlCenter",
        address: "*",
        port: 5000,
        executable:
          "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
        signing_authority: "Apple Code Signing Certification Authority",
      },
      {
        command: "gvproxy",
        address: "*",
        port: 5432,
        executable: "/opt/homebrew/bin/gvproxy",
      },
      {
        command: "node",
        address: "127.0.0.1",
        port: 3000,
      },
    ];

    expect(classifyListenerBucket(sockets[0]!)).toBe("apple_continuity");
    expect(classifyListenerBucket(sockets[1]!)).toBe("apple_continuity");
    expect(classifyListenerBucket(sockets[2]!)).toBe("local_dev");
    expect(classifyListenerBucket(sockets[3]!)).toBe("loopback");

    const findings = extractWildcardListenerFindings(sockets);
    expect(findings).toHaveLength(2);

    const appleFinding = findings.find(
      (finding) => finding.rule_id === "mac.wildcard_listeners_apple_continuity"
    );
    const devFinding = findings.find(
      (finding) => finding.rule_id === "mac.wildcard_listeners_local_dev"
    );

    expect(appleFinding?.severity_hint).toBe("low");
    expect(appleFinding?.title).toContain("Apple continuity/AirPlay");
    expect(devFinding?.severity_hint).toBe("high");
    expect(devFinding?.title).toContain("Local development listeners");
  });

  it("treats post-remediation Apple-only wildcard listeners as low severity", () => {
    const sockets: MacListeningSocket[] = [
      { command: "rapportd", address: "*", port: 55718 },
      { command: "ControlCenter", address: "*", port: 5000 },
      { command: "ControlCenter", address: "*", port: 7000 },
    ];

    const findings = extractWildcardListenerFindings(sockets);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe("mac.wildcard_listeners_apple_continuity");
    expect(findings[0]?.severity_hint).not.toBe("high");
  });

  it("flags wildcard sshd as unknown unsigned exposure", () => {
    const sockets: MacListeningSocket[] = [
      { command: "sshd", address: "0.0.0.0", port: 22 },
    ];

    const findings = extractWildcardListenerFindings(sockets);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe("mac.wildcard_listeners_unknown");
    expect(findings[0]?.severity_hint).toBe("high");
  });
});
