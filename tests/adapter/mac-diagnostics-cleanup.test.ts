import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MacDiagnosticsAdapter } from "@/lib/adapter/mac-diagnostics/index";

const FIXTURES = join(__dirname, "../fixtures");

function findingsFor(raw: string) {
  const adapter = new MacDiagnosticsAdapter();
  const sections = adapter.parseSections(adapter.stripNoise(raw));
  const env = adapter.detectEnvironment(sections);
  return adapter.extractPreFindings(sections, env);
}

describe("mac daily cleanup enrichment", () => {
  it("does not invent cleanup findings when enrichment fields are absent", () => {
    const findings = findingsFor(`=== mac-diagnostics ===
hostname: mac.local
os_name: macOS
os_version: 26.5
filevault_status: On
firewall_state: On
remote_login: Off
remote_management: Off
stealth_mode: On
disk_root_used_percent: 62.0
listening_tcp_json: []
`);

    expect(findings.filter((finding) => finding.rule_id?.startsWith("mac.daily_cleanup_"))).toHaveLength(0);
  });

  it("flags stale cleanup metadata when the workstation is under disk pressure", () => {
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
daily_cleanup_needs_review_summary_json: {"total":3,"by_reason":{"not clearly merged, upstream-gone temp, or stale temp work":2,"path missing; git worktree prune may be enough":1},"by_repo":{"\/Users\/canepro\/src\/support-ai":2,"\/Users\/canepro\/src\/codex-skills":1},"review_buckets":{"protected_outside_home":0,"recent_or_unknown_age":0,"missing_path_prune_candidate":1,"stale_candidate":2,"other":0},"priority_review_candidates":[{"path":"\/Users\/canepro\/src\/support-ai\/.claude\/worktrees\/exciting-heisenberg-6743e7","reason":"not clearly merged, upstream-gone temp, or stale temp work","age_days":53.0},{"path":"\/Users\/canepro\/src\/support-ai\/.claude\/worktrees\/mystifying-kare-228fe8","reason":"not clearly merged, upstream-gone temp, or stale temp work","age_days":52.9},{"path":"\/Users\/canepro\/src\/codex-skills\/.claude\/worktrees\/condescending-poincare-73ad42","reason":"path missing; git worktree prune may be enough"}]}
daily_cleanup_retained_large_stores_json: [{"path":"\/Users\/canepro\/.codex","size_bytes":6648254464,"reason":"large store measured but protected from automatic deletion"}]
daily_cleanup_reclaimed_by_category_json: {"npm":221184}
`);

    const staleReport = findings.find((finding) => finding.rule_id === "mac.daily_cleanup_report_stale");
    const staleCandidates = findings.find(
      (finding) => finding.rule_id === "mac.daily_cleanup_stale_review_candidates"
    );
    const pruneCandidates = findings.find(
      (finding) => finding.rule_id === "mac.daily_cleanup_prune_candidates"
    );
    const retainedStores = findings.find(
      (finding) => finding.rule_id === "mac.daily_cleanup_large_protected_stores"
    );

    expect(staleReport?.title).toContain("disk pressure is warning");
    expect(staleReport?.severity_hint).toBe("medium");
    expect(staleReport?.evidence).toContain("52.4 hours old");
    expect(staleReport?.evidence).toContain("pressure_band=warning");
    expect(staleCandidates?.severity_hint).toBe("low");
    expect(staleCandidates?.evidence).toContain("exciting-heisenberg-6743e7");
    expect(pruneCandidates?.severity_hint).toBe("low");
    expect(pruneCandidates?.title).toContain("prune candidate");
    expect(retainedStores?.title).toContain("disk pressure is warning");
    expect(retainedStores?.severity_hint).toBe("medium");
    expect(retainedStores?.evidence).toContain("/Users/canepro/.codex");

    const correlation = findings.find(
      (finding) => finding.rule_id === "mac.disk_pressure_operational_posture"
    );
    expect(correlation?.evidence).toContain("cleanup_effectiveness=negative");
    expect(correlation?.evidence).toContain("stale_review_candidates=2");
  });

  it("treats invalid cleanup metadata as a pressure issue, not a generic security finding", () => {
    const findings = findingsFor(`=== mac-diagnostics ===
hostname: mac.local
os_name: macOS
os_version: 26.5
filevault_status: On
firewall_state: On
remote_login: Off
remote_management: Off
stealth_mode: On
disk_root_used_percent: 96.0
listening_tcp_json: []
daily_cleanup_report_status: invalid
daily_cleanup_report_error: Expecting value: line 1 column 1 (char 0)
`);

    const invalidReport = findings.find((finding) => finding.rule_id === "mac.daily_cleanup_report_invalid");
    expect(invalidReport?.severity_hint).toBe("high");
    expect(invalidReport?.category).toBe("resource");
    expect(invalidReport?.evidence).toContain("could not be parsed");
  });

  it("drops the missing-path prune finding after action while stale manual-review worktrees remain", () => {
    const before = findingsFor(
      readFileSync(join(FIXTURES, "mac-workstation-diagnostics-cleanup-enriched.txt"), "utf-8")
    );
    const after = findingsFor(
      readFileSync(join(FIXTURES, "mac-workstation-diagnostics-cleanup-actioned.txt"), "utf-8")
    );

    expect(before.some((finding) => finding.rule_id === "mac.daily_cleanup_prune_candidates")).toBe(true);
    expect(after.some((finding) => finding.rule_id === "mac.daily_cleanup_prune_candidates")).toBe(false);

    const staleAfter = after.find(
      (finding) => finding.rule_id === "mac.daily_cleanup_stale_review_candidates"
    );
    expect(staleAfter?.evidence).toContain("exciting-heisenberg-6743e7");
    expect(staleAfter?.evidence).toContain("mystifying-kare-228fe8");
    expect(staleAfter?.evidence).toContain("needs_review_count=19");
    expect(staleAfter?.evidence).not.toContain("condescending-poincare-73ad42");
  });
});
