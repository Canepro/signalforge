import type { EnvironmentContext } from "../../analyzer/schema.js";

export function detectEnvironment(
  sections: Record<string, string>
): EnvironmentContext {
  const identity = sections["SYSTEM IDENTITY"] ?? "";

  const hostname = extractHostname(identity);
  const os = extractOs(identity);
  const kernel = extractKernel(identity);
  const uptime = extractUptime(identity);
  const is_wsl = kernel.toLowerCase().includes("microsoft-standard-wsl");
  const is_container = detectContainer(identity);
  const is_virtual_machine = !is_wsl && !is_container && detectVm(kernel);
  const ran_as_root = detectRoot(sections);

  return {
    hostname,
    os,
    kernel,
    is_wsl,
    is_container,
    is_virtual_machine,
    ran_as_root,
    uptime,
  };
}

function extractHostname(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Hostname")) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("→")) return next;
    }
  }
  return "unknown";
}

function extractOs(text: string): string {
  const match = text.match(/PRETTY_NAME="([^"]+)"/);
  return match?.[1] ?? "unknown";
}

function extractKernel(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Kernel Version")) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("→")) return next;
    }
  }
  return "unknown";
}

function extractUptime(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("System Uptime")) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("→")) return next;
    }
  }
  return "unknown";
}

function detectContainer(text: string): boolean {
  return (
    text.includes("/.dockerenv") ||
    text.includes("docker") ||
    text.includes("containerd")
  );
}

function detectVm(kernel: string): boolean {
  const vmIndicators = ["kvm", "xen", "vmware", "hyperv", "qemu", "virtual"];
  const lower = kernel.toLowerCase();
  return vmIndicators.some((ind) => lower.includes(ind));
}

function detectRoot(sections: Record<string, string>): boolean {
  const allText = Object.values(sections).join("\n");
  if (allText.includes("Not running as root")) return false;
  if (allText.includes("not running as root")) return false;
  if (allText.includes("Access denied to /etc/sudoers")) return false;

  const userSection = sections["USER ACCOUNTS"] ?? "";
  if (userSection.includes("Access denied")) return false;
  if (
    userSection.includes("cat: /etc/sudoers: Permission denied") ||
    userSection.includes("access denied")
  )
    return false;

  return true;
}
