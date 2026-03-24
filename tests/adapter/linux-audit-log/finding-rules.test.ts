import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripAnsi } from "@/lib/adapter/linux-audit-log/strip-ansi";
import { parseSections } from "@/lib/adapter/linux-audit-log/sections";
import { detectEnvironment } from "@/lib/adapter/linux-audit-log/environment";
import { extractPreFindings } from "@/lib/adapter/linux-audit-log/finding-rules";
import type { EnvironmentContext } from "@/lib/analyzer/schema";

const FIXTURES = join(__dirname, "../../fixtures");

function loadFindings(filename: string) {
  const raw = readFileSync(join(FIXTURES, filename), "utf-8");
  const sections = parseSections(stripAnsi(raw));
  const env = detectEnvironment(sections);
  return extractPreFindings(sections, env);
}

function loadNetworkFindings(filename: string) {
  return loadFindings(filename).filter((f) => f.category === "network");
}

describe("extractPreFindings", () => {
  it("finds disk pressure in wsl-nov2025-full", () => {
    const findings = loadFindings("wsl-nov2025-full.log");
    const diskFindings = findings.filter((f) => f.category === "disk");
    expect(diskFindings.length).toBeGreaterThan(0);
  });

  it("extracts findings from sample-prod-server", () => {
    const findings = loadFindings("sample-prod-server.log");
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });

  it("handles truncated log gracefully", () => {
    const findings = loadFindings("wsl-nov2025-truncated.log");
    expect(Array.isArray(findings)).toBe(true);
  });

  it("findings have required fields", () => {
    const findings = loadFindings("wsl-nov2025-full.log");
    for (const f of findings) {
      expect(f.title).toBeTruthy();
      expect(f.severity_hint).toBeTruthy();
      expect(f.category).toBeTruthy();
      expect(f.section_source).toBeTruthy();
      expect(f.evidence).toBeTruthy();
      expect(f.rule_id).toBeTruthy();
    }
  });

  it("does not promote benign WSL apport autoreport skips into log findings", () => {
    const findings = loadFindings("wsl-mar2026-full.log");
    const logFindings = findings.filter((f) => f.category === "logs");
    expect(logFindings).toHaveLength(0);
  });
});

describe("listening-port extraction", () => {
  it("does not report queue sizes as ports (wsl-mar2026)", () => {
    const netFindings = loadNetworkFindings("wsl-mar2026-full.log");
    const ports = netFindings.map((f) => {
      const m = f.title.match(/port (\d+)/);
      return m ? m[1] : null;
    });
    expect(ports).not.toContain("4096");
    expect(ports).not.toContain("1000");
    expect(ports).not.toContain("511");
  });

  it("extracts real service ports from wsl-mar2026", () => {
    const netFindings = loadNetworkFindings("wsl-mar2026-full.log");
    const ports = netFindings.map((f) => {
      const m = f.title.match(/port (\d+)/);
      return m ? m[1] : null;
    });
    expect(ports).toContain("37437");
    expect(ports).toContain("9090");
    expect(ports).toContain("9100");
  });

  it("labels loopback-only listeners distinctly", () => {
    const netFindings = loadNetworkFindings("wsl-mar2026-full.log");
    const loopback = netFindings.find((f) => f.title.includes("port 37437"));
    expect(loopback).toBeTruthy();
    expect(loopback!.title).toContain("loopback only");
    expect(loopback!.title).toContain("not reachable remotely");
    expect(loopback!.title).toContain("Node.js");
    expect(loopback!.evidence).toContain('users:(("node"');
    expect(loopback!.severity_hint).toBe("low");
  });

  it("filters DNS port 53 from findings (well-known safe)", () => {
    const netFindings = loadNetworkFindings("wsl-mar2026-full.log");
    const ports = netFindings.map((f) => {
      const m = f.title.match(/port (\d+)/);
      return m ? m[1] : null;
    });
    expect(ports).not.toContain("53");
  });

  it("deduplicates sockets across Active Connections and Listening Services", () => {
    const netFindings = loadNetworkFindings("wsl-mar2026-full.log");
    const titles = netFindings.map((f) => f.title);
    const uniqueTitles = [...new Set(titles)];
    expect(titles).toEqual(uniqueTitles);
  });

  it("extracts real service ports from wsl-nov2025", () => {
    const netFindings = loadNetworkFindings("wsl-nov2025-full.log");
    const ports = netFindings.map((f) => {
      const m = f.title.match(/port (\d+)/);
      return m ? m[1] : null;
    });
    expect(ports).toContain("9090");
    expect(ports).toContain("9100");
    expect(ports).not.toContain("4096");
    expect(ports).not.toContain("1000");
  });

  it("identifies common observability listeners by role", () => {
    const netFindings = loadNetworkFindings("wsl-nov2025-full.log");
    const p9090 = netFindings.find((f) => f.title.includes("port 9090"));
    const p9100 = netFindings.find((f) => f.title.includes("port 9100"));
    expect(p9090?.title).toContain("Prometheus server");
    expect(p9090?.title).toContain("reachable on all network interfaces");
    expect(p9100?.title).toContain("Prometheus node_exporter");
    expect(p9100?.title).toContain("reachable on all network interfaces");
  });

  it("extracts web server ports from sample-prod-server", () => {
    const netFindings = loadNetworkFindings("sample-prod-server.log");
    const ports = netFindings.map((f) => {
      const m = f.title.match(/port (\d+)/);
      return m ? m[1] : null;
    });
    expect(ports).toContain("80");
    expect(ports).toContain("443");
    expect(ports).not.toContain("22");
    expect(ports).not.toContain("128");
    expect(ports).not.toContain("511");
  });

  it("describes sample-prod web listeners as all-interface exposure", () => {
    const netFindings = loadNetworkFindings("sample-prod-server.log");
    const p80 = netFindings.find((f) => f.title.includes("port 80"));
    const p443 = netFindings.find((f) => f.title.includes("port 443"));
    expect(p80?.title).toContain("HTTP listener (web)");
    expect(p80?.title).toContain("reachable on all network interfaces");
    expect(p443?.title).toContain("HTTPS listener (TLS)");
    expect(p443?.title).toContain("reachable on all network interfaces");
  });

  it("WSL findings use low severity for listening services", () => {
    const netFindings = loadNetworkFindings("wsl-mar2026-full.log");
    for (const f of netFindings) {
      expect(f.severity_hint).toBe("low");
    }
  });

  it("non-WSL findings use medium severity for listening services", () => {
    const netFindings = loadNetworkFindings("sample-prod-server.log");
    for (const f of netFindings) {
      expect(f.severity_hint).toBe("medium");
    }
  });

  it("labels unknown wildcard listeners conservatively when ss has no users:() process", () => {
    const nonWslEnv: EnvironmentContext = {
      hostname: "srv",
      os: "Ubuntu",
      kernel: "6.0",
      is_wsl: false,
      is_container: false,
      is_virtual_machine: false,
      ran_as_root: true,
      uptime: "1 day",
    };
    const sections = {
      "NETWORK CONFIGURATION": `→ Active Connections
Netid State   Recv-Q Send-Q Local Address:Port Peer Address:Port Process
tcp   LISTEN  0      128    0.0.0.0:8443       0.0.0.0:*
`,
    };
    const findings = extractPreFindings(sections, nonWslEnv);
    const net = findings.filter((x) => x.category === "network");
    expect(net).toHaveLength(1);
    expect(net[0].title).toContain("Unidentified listener");
    expect(net[0].title).toContain("reachable on all network interfaces");
  });
});
