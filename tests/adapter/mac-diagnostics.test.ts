import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectArtifactType } from "@/lib/adapter/registry";
import { MacDiagnosticsAdapter } from "@/lib/adapter/mac-diagnostics/index";

const FIXTURES = join(__dirname, "../fixtures");

describe("MacDiagnosticsAdapter", () => {
  const raw = readFileSync(join(FIXTURES, "mac-workstation-diagnostics.txt"), "utf-8");
  const adapter = new MacDiagnosticsAdapter();
  const clean = adapter.stripNoise(raw);
  const sections = adapter.parseSections(clean);

  it("detects mac-diagnostics artifacts", () => {
    expect(detectArtifactType(raw)).toBe("mac-diagnostics");
  });

  it("extracts macOS environment context", () => {
    const env = adapter.detectEnvironment(sections);

    expect(env).toMatchObject({
      hostname: "operator-mac.local",
      os: "macOS 26.5 (25F71)",
      kernel: "25.5.0",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: false,
    });
  });

  it("classifies expected non-root and unavailable MDM visibility as noise", () => {
    const env = adapter.detectEnvironment(sections);
    const noise = adapter.classifyNoise(sections, env).map((item) => item.observation);

    expect(noise).toContain("Mac diagnostics collected without root privileges");
    expect(noise).toContain("MDM enrollment state unavailable");
  });

  it("extracts deterministic Mac findings", () => {
    const env = adapter.detectEnvironment(sections);
    const findings = adapter.extractPreFindings(sections, env);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "macOS application firewall is disabled",
          severity_hint: "medium",
          rule_id: "mac.firewall_disabled",
        }),
        expect.objectContaining({
          title: expect.stringContaining("Remote access posture"),
          severity_hint: "high",
          rule_id: "mac.remote_access_posture",
        }),
        expect.objectContaining({
          title: expect.stringContaining("Unsigned or unclassified listeners"),
          severity_hint: "high",
          rule_id: "mac.wildcard_listeners_unknown",
        }),
        expect.objectContaining({
          title: expect.stringContaining("Local development listeners on loopback"),
          severity_hint: "low",
          rule_id: "mac.loopback_local_dev_listeners",
        }),
        expect.objectContaining({
          title: "Mac root volume disk pressure is warning (91.2% used)",
          severity_hint: "medium",
          rule_id: "mac.disk_pressure",
        }),
        expect.objectContaining({
          title: "12 Homebrew packages pending upgrade",
          severity_hint: "low",
          rule_id: "mac.homebrew_outdated",
        }),
      ])
    );
  });

  it("post-remediation Apple-only listeners stay low severity with evidence-specific remote access", () => {
    const postRemediation = readFileSync(
      join(FIXTURES, "mac-workstation-post-remediation.txt"),
      "utf-8"
    );
    const postSections = adapter.parseSections(adapter.stripNoise(postRemediation));
    const env = adapter.detectEnvironment(postSections);
    const findings = adapter.extractPreFindings(postSections, env);

    const wildcardFindings = findings.filter((finding) =>
      finding.rule_id.startsWith("mac.wildcard_listeners_")
    );
    expect(wildcardFindings).toHaveLength(1);
    expect(wildcardFindings[0]).toMatchObject({
      rule_id: "mac.wildcard_listeners_apple_continuity",
      severity_hint: "medium",
    });
    expect(
      findings.some((finding) => finding.rule_id === "mac.wildcard_listeners_local_dev")
    ).toBe(false);

    const posture = findings.find((finding) => finding.rule_id === "mac.remote_access_posture");
    expect(posture?.title).toContain("administrator verification");
    expect(posture?.evidence).toContain("SSH (22/tcp)");
    expect(posture?.evidence).toContain("not verified");

    expect(
      findings.some((finding) => finding.rule_id === "mac.file_sharing_guest_inactive")
    ).toBe(true);
  });

  it("ignores non-array listener JSON instead of throwing", () => {
    const malformedSections = {
      ...sections,
      listening_tcp_json: '"sshd"',
    };
    const env = adapter.detectEnvironment(malformedSections);

    expect(() => adapter.extractPreFindings(malformedSections, env)).not.toThrow();
    expect(
      adapter
        .extractPreFindings(malformedSections, env)
        .some((finding) => finding.rule_id.startsWith("mac.wildcard_listeners_"))
    ).toBe(false);
  });

  it("marks incomplete artifacts when required Mac fields are missing", () => {
    const incompleteSections = adapter.parseSections("=== mac-diagnostics ===\nhostname: mac\n");
    expect(adapter.detectIncomplete(incompleteSections)).toEqual({
      incomplete: true,
      reason:
        "Missing required macOS diagnostic fields: os_name, os_version, firewall_state, filevault_status",
    });
  });
});
