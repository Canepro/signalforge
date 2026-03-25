import type { ArtifactAdapter } from "../types";
import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema";
import {
  containerValueFor,
  parseContainerBoolean,
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
    const secrets = parseContainerList(sections.secrets);

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
    if (image.endsWith(":latest") || (!image.includes("@sha256:") && !image.includes(":"))) {
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
