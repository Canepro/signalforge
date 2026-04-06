import { describe, expect, it, vi } from "vitest";
import { loadDashboardReadModel } from "@/lib/dashboard-read-model";
import type { DashboardCollectionSourceState, SourceView, Storage } from "@/lib/storage/contract";

function mkSource(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: overrides.id ?? "source-1",
    display_name: overrides.display_name ?? "Source",
    target_identifier: overrides.target_identifier ?? "target-1",
    source_type: overrides.source_type ?? "linux_host",
    expected_artifact_type: overrides.expected_artifact_type ?? "linux-audit-log",
    default_collector_type: overrides.default_collector_type ?? "signalforge-collectors",
    default_collector_version: overrides.default_collector_version ?? null,
    capabilities: overrides.capabilities ?? ["collect:linux-audit-log"],
    attributes: overrides.attributes ?? {},
    labels: overrides.labels ?? {},
    default_collection_scope: overrides.default_collection_scope ?? null,
    enabled: overrides.enabled ?? true,
    last_seen_at: overrides.last_seen_at ?? null,
    health_status: overrides.health_status ?? "unknown",
    created_at: overrides.created_at ?? "2026-04-01T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-01T10:00:00.000Z",
  };
}

describe("loadDashboardReadModel", () => {
  it("uses dashboard-scoped run reads instead of full-history summaries", async () => {
    const sourceStates: DashboardCollectionSourceState[] = [
      {
        source: mkSource({
          id: "source-online-registered",
          display_name: "Online Registered",
          health_status: "online",
          last_seen_at: "2026-04-06T10:00:00.000Z",
        }),
        hasRegistration: true,
      },
      {
        source: mkSource({
          id: "source-online-unregistered",
          display_name: "Online Unregistered",
          health_status: "online",
        }),
        hasRegistration: false,
      },
      {
        source: mkSource({
          id: "source-offline-registered",
          display_name: "Offline Registered",
          health_status: "offline",
        }),
        hasRegistration: true,
      },
    ];

    const listSummaries = vi
      .fn()
      .mockRejectedValue(new Error("unexpected full-history run summary read"));
    const getRegistrationBySourceId = vi
      .fn()
      .mockRejectedValue(new Error("unexpected per-source registration lookup"));
    const listDashboardRecentRuns = vi.fn().mockResolvedValue([]);
    const listDashboardWindowRuns = vi.fn().mockResolvedValue([]);
    const countRuns = vi.fn().mockResolvedValue(17);

    const storage = {
      runs: {
        listSummaries,
        countRuns,
        listDashboardRecentRuns,
        listDashboardWindowRuns,
        countSuppressedNoise: vi.fn().mockResolvedValue(0),
        listDashboardSignalRuns: vi.fn().mockResolvedValue([]),
      },
      sources: {
        listDashboardCollectionSourceStates: vi.fn().mockResolvedValue(sourceStates),
      },
      agents: {
        getRegistrationBySourceId,
      },
    } as unknown as Storage;

    const model = await loadDashboardReadModel(storage, Date.parse("2026-04-06T12:00:00.000Z"));

    expect(listSummaries).not.toHaveBeenCalled();
    expect(listDashboardRecentRuns).toHaveBeenCalledWith(200);
    expect(listDashboardWindowRuns).toHaveBeenCalledWith("2026-02-24T00:00:00.000Z");
    expect(countRuns).toHaveBeenCalledTimes(1);
    expect(getRegistrationBySourceId).not.toHaveBeenCalled();
    expect(storage.sources.listDashboardCollectionSourceStates).toHaveBeenCalledWith({ enabled: true });

    expect(model.collectionSources).toEqual([
      {
        id: "source-online-registered",
        display_name: "Online Registered",
        target_identifier: "target-1",
        expected_artifact_type: "linux-audit-log",
        last_seen_at: "2026-04-06T10:00:00.000Z",
        default_collection_scope: null,
      },
    ]);

    expect(model.collectionPulse.configuredSources).toBe(2);
    expect(model.collectionPulse.onlineSources).toBe(1);
    expect(model.totalRuns).toBe(17);
  });
});
