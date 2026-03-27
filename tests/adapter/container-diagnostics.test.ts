import { describe, expect, it } from "vitest";
import { ContainerDiagnosticsAdapter } from "@/lib/adapter/container-diagnostics/index";

const RAW = `=== container-diagnostics ===
hostname: node-a
runtime: docker
container_name: payments-api
container_id: abc123
image: ghcr.io/acme/payments:latest
state_status: restarting
health_status: unhealthy
restart_count: 7
oom_killed: true
exit_code: 137
published_ports: 8080/tcp, 8443/tcp
privileged: true
host_network: true
host_pid: true
added_capabilities: SYS_ADMIN, NET_ADMIN
allow_privilege_escalation: true
mounts: /var/run/docker.sock:/var/run/docker.sock,/srv/data:/data
writable_mounts: /data
read_only_rootfs: false
secrets: /run/secrets/db-password
ran_as_root: true
memory_limit_bytes: 0
memory_reservation_bytes: 268435456
cpu_percent: 94.10
memory_percent: 96.30
pid_count: 31
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
    expect(findings.some((finding) => finding.title.includes("runtime state is restarting"))).toBe(
      true
    );
    expect(findings.some((finding) => finding.title.includes("health check is failing"))).toBe(
      true
    );
    expect(findings.some((finding) => finding.title.includes("restarted 7 times"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("OOM-killed"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("no memory limit"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("memory usage is elevated"))).toBe(
      true
    );
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
    expect(findings.some((finding) => finding.title.includes("writable mounted volumes"))).toBe(
      true
    );
    expect(
      findings.some((finding) => finding.title.includes("root filesystem is not read-only"))
    ).toBe(true);
  });

  it("does not add runtime-health findings for a healthy running container with limits", () => {
    const adapter = new ContainerDiagnosticsAdapter();
    const clean = adapter.stripNoise(`=== container-diagnostics ===
hostname: node-d
runtime: docker
container_name: payments-api
container_id: jkl012
image: ghcr.io/acme/payments:1.2.3
state_status: running
health_status: healthy
restart_count: 0
oom_killed: false
memory_limit_bytes: 536870912
memory_percent: 41.20
`);
    const sections = adapter.parseSections(clean);
    const findings = adapter.extractPreFindings(sections, adapter.detectEnvironment(sections));

    expect(findings.some((finding) => finding.rule_id === "container.runtime_state")).toBe(false);
    expect(findings.some((finding) => finding.rule_id === "container.health_unhealthy")).toBe(
      false
    );
    expect(findings.some((finding) => finding.rule_id === "container.restart_count")).toBe(false);
    expect(findings.some((finding) => finding.rule_id === "container.oom_killed")).toBe(false);
    expect(findings.some((finding) => finding.rule_id === "container.memory_limit_missing")).toBe(
      false
    );
    expect(findings.some((finding) => finding.rule_id === "container.memory_pressure")).toBe(
      false
    );
  });

  it("skips the rootfs hardening finding when read_only_rootfs is absent", () => {
    const adapter = new ContainerDiagnosticsAdapter();
    const clean = adapter.stripNoise(`=== container-diagnostics ===
hostname: node-b
runtime: docker
container_name: payments-api
container_id: def456
image: ghcr.io/acme/payments:1.2.3
`);
    const sections = adapter.parseSections(clean);
    const findings = adapter.extractPreFindings(sections, adapter.detectEnvironment(sections));

    expect(
      findings.some((finding) => finding.rule_id === "container.read_only_rootfs")
    ).toBe(false);
  });

  it("flags untagged images from registries with port numbers", () => {
    const adapter = new ContainerDiagnosticsAdapter();
    const clean = adapter.stripNoise(`=== container-diagnostics ===
hostname: node-c
runtime: docker
container_name: payments-api
container_id: ghi789
image: registry.example:5000/team/payments-api
`);
    const sections = adapter.parseSections(clean);
    const findings = adapter.extractPreFindings(sections, adapter.detectEnvironment(sections));

    expect(findings.some((finding) => finding.rule_id === "container.image_unpinned")).toBe(true);
  });
});
