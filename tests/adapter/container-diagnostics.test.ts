import { describe, expect, it } from "vitest";
import { ContainerDiagnosticsAdapter } from "@/lib/adapter/container-diagnostics/index";

const RAW = `=== container-diagnostics ===
hostname: node-a
runtime: docker
container_name: payments-api
container_id: abc123
image: ghcr.io/acme/payments:latest
published_ports: 8080/tcp, 8443/tcp
privileged: true
host_network: true
host_pid: true
added_capabilities: SYS_ADMIN, NET_ADMIN
allow_privilege_escalation: true
mounts: /var/run/docker.sock:/var/run/docker.sock,/srv/data:/data
secrets: /run/secrets/db-password
ran_as_root: true
`;

describe("ContainerDiagnosticsAdapter", () => {
  it("detects container environment and extracts first-slice findings", () => {
    const adapter = new ContainerDiagnosticsAdapter();
    const clean = adapter.stripNoise(RAW);
    const sections = adapter.parseSections(clean);
    const env = adapter.detectEnvironment(sections);
    const findings = adapter.extractPreFindings(sections, env);
    const incomplete = adapter.detectIncomplete(sections);

    expect(env.is_container).toBe(true);
    expect(env.hostname).toBe("node-a");
    expect(env.os).toContain("docker");
    expect(incomplete.incomplete).toBe(false);
    expect(findings.some((finding) => finding.title.includes("publishes ports"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("privileged"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("Docker socket"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("mounted secrets"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("runs as root"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("not pinned"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("host PID"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("Linux capabilities"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("privilege escalation"))).toBe(
      true
    );
  });
});
