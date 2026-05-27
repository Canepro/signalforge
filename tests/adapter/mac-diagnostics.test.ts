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
          title: "Remote Login is enabled",
          severity_hint: "medium",
          rule_id: "mac.remote_login_enabled",
        }),
        expect.objectContaining({
          title: "Mac has 2 listening TCP services",
          severity_hint: "high",
          rule_id: "mac.listening_tcp_services",
        }),
        expect.objectContaining({
          title: "Mac root volume usage is elevated (91.2%)",
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

  it("marks incomplete artifacts when required Mac fields are missing", () => {
    const incompleteSections = adapter.parseSections("=== mac-diagnostics ===\nhostname: mac\n");
    expect(adapter.detectIncomplete(incompleteSections)).toEqual({
      incomplete: true,
      reason:
        "Missing required macOS diagnostic fields: os_name, os_version, firewall_state, filevault_status",
    });
  });
});
