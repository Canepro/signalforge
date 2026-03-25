import { notFound } from "next/navigation";
import type { CompareRunSnapshot } from "@/lib/compare/build-compare";
import { CompareClient, type CompareRunHeader } from "./compare-client";
import { getStorage } from "@/lib/storage";

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

  return (
    <CompareClient
      current={current}
      baseline={baseline}
      drift={payload.drift}
      evidenceDelta={payload.evidence_delta}
      targetMismatch={payload.target_mismatch}
      baselineMissing={payload.baseline_missing}
    />
  );
}
