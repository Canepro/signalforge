import { notFound } from "next/navigation";
import type { CompareRunSnapshot } from "@/lib/compare/build-compare";
import { CompareClient, type CompareRunHeader } from "./compare-client";
import { getStorage } from "@/lib/storage";
import { preferredTargetMatchKey } from "@/lib/target-identity";

export const dynamic = "force-dynamic";

function formatRunTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function headerFromSnapshot(s: CompareRunSnapshot): CompareRunHeader {
  return {
    id: s.id,
    filename: s.filename,
    created_at_label: formatRunTimestamp(s.created_at),
    target_name: s.target_display_label,
  };
}

interface ComparePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ against?: string }>;
}

export default async function ComparePage({ params, searchParams }: ComparePageProps) {
  const { id: currentId } = await params;
  const { against } = await searchParams;
  const storage = await getStorage();
  const result = await storage.runs.getComparePayload(currentId, against);
  if (!result.ok) {
    notFound();
  }

  const { payload } = result;
  const current = headerFromSnapshot(payload.current);
  const baseline = payload.baseline ? headerFromSnapshot(payload.baseline) : null;
  const allRuns = await storage.runs.listSummaries();
  const currentKey = preferredTargetMatchKey({
    target_identifier: payload.current.target_identifier,
    environment_hostname: payload.current.environment_hostname,
  });
  const baselineCandidates =
    currentKey === null
      ? []
      : allRuns
          .filter((run) => run.id !== currentId)
          .filter((run) => new Date(run.created_at).getTime() < new Date(payload.current.created_at).getTime())
          .filter(
            (run) =>
              preferredTargetMatchKey({
                target_identifier: run.target_identifier,
                environment_hostname: run.hostname,
                artifact_type: run.artifact_type,
              }) === currentKey
          )
          .slice(0, 6)
          .map((run) => ({
            id: run.id,
            filename: run.filename,
            created_at_label: run.created_at_label ?? formatRunTimestamp(run.created_at),
            target_name: run.target_identifier ?? run.hostname,
          }));

  return (
    <CompareClient
      current={current}
      baseline={baseline}
      drift={payload.drift}
      evidenceDelta={payload.evidence_delta}
      targetMismatch={payload.target_mismatch}
      baselineMissing={payload.baseline_missing}
      baselineSelection={payload.baseline_selection}
      baselineCandidates={baselineCandidates}
    />
  );
}
