import type { EnvironmentContext, NoiseItem } from "../../analyzer/schema.js";

interface NoiseRule {
  id: string;
  pattern: RegExp;
  observation: string;
  reason: string;
  environment: string;
  condition: (env: EnvironmentContext) => boolean;
}

const RULES: NoiseRule[] = [
  {
    id: "wsl-ssh-service",
    pattern: /Unit ssh\.?service could not be found|ssh\.service.*not found/i,
    observation: "SSH service not found",
    reason: "SSH daemon is typically not installed in WSL by default",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-sshd-service",
    pattern: /Unit sshd\.service could not be found/i,
    observation: "SSHD service not found",
    reason: "SSH daemon is typically not installed in WSL by default",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-apparmor",
    pattern: /apparmor.*not present|apparmor.*not mounted|apparmor_parser.*not found/i,
    observation: "AppArmor not present",
    reason: "AppArmor filesystem is not mounted in standard WSL2 kernels",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-dxg-ioctl",
    pattern: /dxgkio_is_feature_enabled.*ioctl failed/i,
    observation: "dxg ioctl errors in journal",
    reason:
      "DirectX/GPU passthrough integration noise in WSL2; does not indicate a real failure",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-getaddrinfo",
    pattern: /WSL.*getaddrinfo\(\) failed/i,
    observation: "WSL getaddrinfo failures in syslog",
    reason:
      "Transient DNS resolution noise from WSL networking layer; typically harmless",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-init-timeout",
    pattern: /WaitForBootProcess.*\/sbin\/init failed to start/i,
    observation: "WSL init timeout error",
    reason: "WSL boot process occasionally times out; does not indicate compromise",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-pro-service",
    pattern: /wsl-pro-service.*input\/output error/i,
    observation: "wsl-pro-service I/O error",
    reason:
      "Ubuntu Pro Windows agent not reachable; expected when Pro is not configured",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-nvmf-openipmi",
    pattern: /nvmf-autoconnect\.service|openipmi\.service/i,
    observation: "NVMe-oF or OpenIPMI service failures",
    reason: "Hardware management services not applicable in WSL2 environment",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-tmpfiles-readonly",
    pattern: /systemd-tmpfiles.*Read-only file system/i,
    observation: "tmpfiles read-only filesystem errors",
    reason: "WSL2 /tmp or X11 socket area is read-only at early boot",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "wsl-pam-lastlog",
    pattern: /pam_lastlog\.so.*No such file/i,
    observation: "PAM lastlog module missing",
    reason: "pam_lastlog.so is not included in standard WSL2 Ubuntu installations",
    environment: "WSL",
    condition: (env) => env.is_wsl,
  },
  {
    id: "rpm-on-debian",
    pattern: /rpm:.*cannot execute binary file|rpm:.*Exec format error/i,
    observation: "rpm command failed with exec format error",
    reason:
      "rpm binary is not compatible with this Debian/Ubuntu system; cross-platform artifact",
    environment: "cross-platform",
    condition: (env) =>
      env.os.toLowerCase().includes("ubuntu") ||
      env.os.toLowerCase().includes("debian"),
  },
  {
    id: "nonroot-sudoers",
    pattern:
      /Access denied to \/etc\/sudoers|cat: \/etc\/sudoers: Permission denied/i,
    observation: "Cannot read /etc/sudoers",
    reason: "Audit was not run as root; sudoers file is not readable",
    environment: "non-root",
    condition: (env) => !env.ran_as_root,
  },
  {
    id: "nonroot-lastb",
    pattern: /lastb.*Permission denied|No failed login records or access denied/i,
    observation: "Cannot read failed login records",
    reason: "lastb requires root privileges; expected when running as non-root",
    environment: "non-root",
    condition: (env) => !env.ran_as_root,
  },
  {
    id: "nonroot-iptables",
    pattern: /iptables.*Permission denied|iptables.*Operation not permitted/i,
    observation: "Cannot query iptables rules",
    reason: "iptables requires root privileges; expected when running as non-root",
    environment: "non-root",
    condition: (env) => !env.ran_as_root,
  },
  {
    id: "crontab-empty",
    pattern: /no crontab for root/i,
    observation: "No crontab for root",
    reason:
      "Root crontab is empty; this is normal for systems that use /etc/cron.d or systemd timers instead",
    environment: "general",
    condition: () => true,
  },
];

export function classifyNoise(
  sections: Record<string, string>,
  env: EnvironmentContext
): NoiseItem[] {
  const allText = Object.values(sections).join("\n");
  const found: NoiseItem[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (!rule.condition(env)) continue;
    if (rule.pattern.test(allText) && !seen.has(rule.id)) {
      seen.add(rule.id);
      found.push({
        observation: rule.observation,
        reason_expected: rule.reason,
        related_environment: rule.environment,
      });
    }
  }

  return found;
}
