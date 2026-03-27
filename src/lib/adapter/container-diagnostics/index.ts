import type { ArtifactAdapter } from "../types";
import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema";
import {
  containerValueFor,
  parseContainerBoolean,
  parseContainerFloat,
  parseContainerInteger,
  parseContainerList,
  parseContainerSections,
} from "./parse";

export class ContainerDiagnosticsAdapter implements ArtifactAdapter {
  readonly type = "container-diagnostics";

  stripNoise(raw: string): string {
    return raw.replace(/\r\n/g, "\n").trim();
  }

  parseSections(clean: string): Record<string, string> {
    return parseContainerSections(clean);
  }

  detectEnvironment(sections: Record<string, string>): EnvironmentContext {
    const runtime = containerValueFor(sections, "runtime") || "unknown-runtime";
    return {
      hostname:
        containerValueFor(sections, "hostname") ||
        containerValueFor(sections, "node") ||
        "unknown-host",
      os: `Container (${runtime})`,
      kernel: containerValueFor(sections, "kernel") || runtime,
      is_wsl: false,
      is_container: true,
      is_virtual_machine: false,
      ran_as_root: parseContainerBoolean(sections.ran_as_root),
      uptime: containerValueFor(sections, "uptime") || "unknown",
    };
  }

  classifyNoise(_sections: Record<string, string>, _env: EnvironmentContext): NoiseItem[] {
    return [];
  }

  extractPreFindings(
    sections: Record<string, string>,
    _env: EnvironmentContext
  ): PreFinding[] {
    const findings: PreFinding[] = [];
    const publishedPorts = parseContainerList(sections.published_ports);
    const mounts = parseContainerList(sections.mounts);
    const writableMounts = parseContainerList(sections.writable_mounts);
    const secrets = parseContainerList(sections.secrets);
    const stateStatus = containerValueFor(sections, "state_status").toLowerCase();
    const healthStatus = containerValueFor(sections, "health_status").toLowerCase();
    const restartCount = parseContainerInteger(sections.restart_count);
    const memoryLimitBytes = parseContainerInteger(sections.memory_limit_bytes);
    const memoryPercent = parseContainerFloat(sections.memory_percent);

    if (stateStatus && stateStatus !== "running") {
      findings.push({
        title: `Container runtime state is ${stateStatus}`,
        severity_hint:
          stateStatus === "paused" || stateStatus === "created" ? "medium" : "high",
        category: "container",
        section_source: "state_status",
        evidence: sections.state_status,
        rule_id: "container.runtime_state",
      });
    }

    if (healthStatus === "unhealthy") {
      findings.push({
        title: "Container health check is failing",
        severity_hint: "high",
        category: "container",
        section_source: "health_status",
        evidence: sections.health_status,
        rule_id: "container.health_unhealthy",
      });
    }

    if (parseContainerBoolean(sections.oom_killed)) {
      findings.push({
        title: "Container was OOM-killed",
        severity_hint: "high",
        category: "container",
        section_source: "oom_killed",
        evidence: sections.oom_killed,
        rule_id: "container.oom_killed",
      });
    }

    if (restartCount !== null && restartCount >= 3) {
      findings.push({
        title: `Container restarted ${restartCount} times`,
        severity_hint: restartCount >= 10 ? "high" : "medium",
        category: "container",
        section_source: "restart_count",
        evidence: sections.restart_count,
        rule_id: "container.restart_count",
      });
    }

    if (memoryLimitBytes === 0) {
      findings.push({
        title: "Container has no memory limit configured",
        severity_hint: "medium",
        category: "container",
        section_source: "memory_limit_bytes",
        evidence: sections.memory_limit_bytes,
        rule_id: "container.memory_limit_missing",
      });
    }

    if (memoryPercent !== null && memoryPercent >= 90) {
      findings.push({
        title: `Container memory usage is elevated (${memoryPercent.toFixed(1)}%)`,
        severity_hint: memoryPercent >= 95 ? "high" : "medium",
        category: "resource",
        section_source: "memory_percent",
        evidence: sections.memory_percent,
        rule_id: "container.memory_pressure",
      });
    }

    if (publishedPorts.length > 0) {
      findings.push({
        title: `Container publishes ports: ${publishedPorts.join(", ")}`,
        severity_hint: "medium",
        category: "network",
        section_source: "published_ports",
        evidence: sections.published_ports,
        rule_id: "container.published_ports",
      });
    }

    if (parseContainerBoolean(sections.privileged)) {
      findings.push({
        title: "Container runs in privileged mode",
        severity_hint: "high",
        category: "container",
        section_source: "privileged",
        evidence: sections.privileged,
        rule_id: "container.privileged",
      });
    }

    if (parseContainerBoolean(sections.host_network)) {
      findings.push({
        title: "Container uses host network mode",
        severity_hint: "high",
        category: "container",
        section_source: "host_network",
        evidence: sections.host_network,
        rule_id: "container.host_network",
      });
    }

    if (parseContainerBoolean(sections.host_pid)) {
      findings.push({
        title: "Container shares the host PID namespace",
        severity_hint: "high",
        category: "container",
        section_source: "host_pid",
        evidence: sections.host_pid,
        rule_id: "container.host_pid",
      });
    }

    if (parseContainerBoolean(sections.ran_as_root)) {
      findings.push({
        title: "Container runs as root",
        severity_hint: "medium",
        category: "container",
        section_source: "ran_as_root",
        evidence: sections.ran_as_root,
        rule_id: "container.runs_as_root",
      });
    }

    const addedCapabilities = parseContainerList(sections.added_capabilities);
    if (addedCapabilities.length > 0) {
      findings.push({
        title: `Container adds Linux capabilities: ${addedCapabilities.join(", ")}`,
        severity_hint: "medium",
        category: "container",
        section_source: "added_capabilities",
        evidence: sections.added_capabilities,
        rule_id: "container.added_capabilities",
      });
    }

    if (parseContainerBoolean(sections.allow_privilege_escalation)) {
      findings.push({
        title: "Container allows privilege escalation",
        severity_hint: "medium",
        category: "container",
        section_source: "allow_privilege_escalation",
        evidence: sections.allow_privilege_escalation,
        rule_id: "container.allow_privilege_escalation",
      });
    }

    if (mounts.some((mount) => mount.includes("/var/run/docker.sock"))) {
      findings.push({
        title: "Container mounts the Docker socket",
        severity_hint: "high",
        category: "container",
        section_source: "mounts",
        evidence: mounts.find((mount) => mount.includes("/var/run/docker.sock")) ?? sections.mounts,
        rule_id: "container.docker_socket",
      });
    }

    if (mounts.some((mount) => mount.startsWith("/") && mount.includes(":/"))) {
      findings.push({
        title: "Container has direct host-path mounts",
        severity_hint: "medium",
        category: "container",
        section_source: "mounts",
        evidence: sections.mounts,
        rule_id: "container.host_path",
      });
    }

    if (writableMounts.length > 0) {
      findings.push({
        title: "Container has writable mounted volumes",
        severity_hint: "medium",
        category: "container",
        section_source: "writable_mounts",
        evidence: sections.writable_mounts,
        rule_id: "container.writable_mounts",
      });
    }

    const readOnlyRootfsValue = sections.read_only_rootfs?.trim();
    if (readOnlyRootfsValue && !parseContainerBoolean(readOnlyRootfsValue)) {
      findings.push({
        title: "Container root filesystem is not read-only",
        severity_hint: "medium",
        category: "container",
        section_source: "read_only_rootfs",
        evidence: readOnlyRootfsValue,
        rule_id: "container.read_only_rootfs",
      });
    }

    if (secrets.length > 0) {
      findings.push({
        title: "Container receives mounted secrets",
        severity_hint: "medium",
        category: "container",
        section_source: "secrets",
        evidence: sections.secrets,
        rule_id: "container.secrets",
      });
    }

    const image = containerValueFor(sections, "image");
    if (isUnpinnedContainerImage(image)) {
      findings.push({
        title: "Container image is not pinned to an immutable version",
        severity_hint: "low",
        category: "container",
        section_source: "image",
        evidence: image,
        rule_id: "container.image_unpinned",
      });
    }

    return findings;
  }

  detectIncomplete(sections: Record<string, string>): {
    incomplete: boolean;
    reason?: string;
  } {
    const hasIdentity =
      Boolean(sections.container_name) || Boolean(sections.container_id) || Boolean(sections.image);
    if (!hasIdentity || !sections.runtime) {
      return {
        incomplete: true,
        reason: "Missing core container identity or runtime fields",
      };
    }
    return { incomplete: false };
  }
}

function isUnpinnedContainerImage(image: string): boolean {
  const trimmedImage = image.trim();
  if (!trimmedImage) return false;
  if (trimmedImage.includes("@sha256:")) return false;
  if (trimmedImage.endsWith(":latest")) return true;

  const lastSlash = trimmedImage.lastIndexOf("/");
  const lastSegment = lastSlash >= 0 ? trimmedImage.slice(lastSlash + 1) : trimmedImage;
  return !lastSegment.includes(":");
}
