import { describe, expect, it } from "vitest";
import { MacDiagnosticsAdapter } from "@/lib/adapter/mac-diagnostics/index";
import {
  DISK_PRESSURE_URGENT_THRESHOLD,
  DISK_PRESSURE_WARNING_THRESHOLD,
  classifyDiskPressureBand,
} from "@/lib/adapter/mac-diagnostics/disk-pressure";

function findingsFor(raw: string) {
  const adapter = new MacDiagnosticsAdapter();
  const sections = adapter.parseSections(adapter.stripNoise(raw));
  const env = adapter.detectEnvironment(sections);
  return adapter.extractPreFindings(sections, env);
}

describe("mac disk pressure bands", () => {
  it("classifies warning and urgent bands at the documented thresholds", () => {
    expect(classifyDiskPressureBand(null)).toBeNull();
    expect(classifyDiskPressureBand(84.9)).toBeNull();
    expect(classifyDiskPressureBand(DISK_PRESSURE_WARNING_THRESHOLD)).toBe("warning");
    expect(classifyDiskPressureBand(91.2)).toBe("warning");
    expect(classifyDiskPressureBand(DISK_PRESSURE_URGENT_THRESHOLD - 0.1)).toBe("warning");
    expect(classifyDiskPressureBand(DISK_PRESSURE_URGENT_THRESHOLD)).toBe("urgent");
    expect(classifyDiskPressureBand(98.0)).toBe("urgent");
  });

  it("emits banded disk pressure and cleanup correlation on the enriched fixture shape", () => {
    const findings = findingsFor(`=== mac-diagnostics ===
hostname: mac.local
os_name: macOS
os_version: 26.5
filevault_status: On
firewall_state: On
remote_login: Off
remote_management: Off
stealth_mode: On
disk_root_used_percent: 91.2
listening_tcp_json: []
daily_cleanup_report_status: stale
daily_cleanup_report_age_hours: 52.4
daily_cleanup_free_space_delta_bytes: -1388544
daily_cleanup_needs_review_count: 3
daily_cleanup_needs_review_summary_json: {"total":3,"review_buckets":{"stale_candidate":2,"missing_path_prune_candidate":1},"priority_review_candidates":[{"path":"/Users/operator/src/support-ai/.claude/worktrees/stale-one","age_days":53.0},{"path":"/Users/operator/src/codex-skills/.claude/worktrees/missing-one","reason":"path missing; git worktree prune may be enough"}]}
daily_cleanup_retained_large_stores_json: [{"path":"/Users/operator/.codex","size_bytes":6648254464,"reason":"large store measured but protected from automatic deletion"}]
daily_cleanup_reclaimed_by_category_json: {"npm":221184}
`);

    const diskPressure = findings.find((finding) => finding.rule_id === "mac.disk_pressure");
    const correlation = findings.find(
      (finding) => finding.rule_id === "mac.disk_pressure_operational_posture"
    );
    const ineffective = findings.find(
      (finding) => finding.rule_id === "mac.daily_cleanup_ineffective_under_pressure"
    );

    expect(diskPressure?.title).toContain("disk pressure is warning");
    expect(diskPressure?.evidence).toContain("pressure_band=warning");
    expect(correlation?.title).toContain("warning disk pressure correlates with cleanup posture drift");
    expect(correlation?.evidence).toContain("cleanup_report_status=stale");
    expect(correlation?.evidence).toContain("cleanup_effectiveness=negative");
    expect(correlation?.evidence).toContain("stale_review_candidates=2");
    expect(correlation?.evidence).toContain("retained_large_store_bytes=6648254464");
    expect(ineffective?.title).toContain("did not increase free space");
    expect(ineffective?.severity_hint).toBe("medium");
  });

  it("does not emit cleanup correlation when cleanup is present and effective under warning pressure", () => {
    const findings = findingsFor(`=== mac-diagnostics ===
hostname: mac.local
os_name: macOS
os_version: 26.5
filevault_status: On
firewall_state: On
remote_login: Off
remote_management: Off
stealth_mode: On
disk_root_used_percent: 88.0
listening_tcp_json: []
daily_cleanup_report_status: present
daily_cleanup_report_age_hours: 4.0
daily_cleanup_free_space_delta_bytes: 5368709120
daily_cleanup_needs_review_summary_json: {"total":0,"review_buckets":{"stale_candidate":0,"missing_path_prune_candidate":0}}
daily_cleanup_retained_large_stores_json: []
`);

    expect(
      findings.some((finding) => finding.rule_id === "mac.disk_pressure_operational_posture")
    ).toBe(false);
    expect(
      findings.some((finding) => finding.rule_id === "mac.daily_cleanup_ineffective_under_pressure")
    ).toBe(false);
    expect(findings.some((finding) => finding.rule_id === "mac.disk_pressure")).toBe(true);
  });

  it("escalates urgent disk pressure correlation severity when cleanup metadata is stale", () => {
    const findings = findingsFor(`=== mac-diagnostics ===
hostname: mac.local
os_name: macOS
os_version: 26.5
filevault_status: On
firewall_state: On
remote_login: Off
remote_management: Off
stealth_mode: On
disk_root_used_percent: 96.4
listening_tcp_json: []
daily_cleanup_report_status: stale
daily_cleanup_report_age_hours: 60.0
daily_cleanup_free_space_delta_bytes: -5242880
daily_cleanup_needs_review_summary_json: {"total":1,"review_buckets":{"stale_candidate":1},"priority_review_candidates":[{"path":"/Users/operator/src/demo/.claude/worktrees/old-one","age_days":40.0}]}
`);

    const diskPressure = findings.find((finding) => finding.rule_id === "mac.disk_pressure");
    const correlation = findings.find(
      (finding) => finding.rule_id === "mac.disk_pressure_operational_posture"
    );

    expect(diskPressure?.title).toContain("disk pressure is urgent");
    expect(diskPressure?.severity_hint).toBe("high");
    expect(correlation?.severity_hint).toBe("high");
    expect(correlation?.evidence).toContain("pressure_band=urgent");
  });
});