import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getRun, getRunWithArtifact, deriveSeverityCounts } from "@/lib/db/repository";
import { RunDetailClient } from "./run-detail-client";
import type { RunDetail } from "@/types/api";

export const dynamic = "force-dynamic";

interface RunDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatRunTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;
  const db = await getDb();
  const row = getRunWithArtifact(db, id);

  if (!row) notFound();

  let parent_run: { id: string; filename: string } | null = null;
  if (row.parent_run_id) {
    const p = getRun(db, row.parent_run_id);
    if (p) parent_run = { id: p.id, filename: p.filename };
  }

  const run: RunDetail = {
    id: row.id,
    artifact_id: row.artifact_id,
    parent_run_id: row.parent_run_id,
    parent_run,
    filename: row.filename,
    artifact_type: row.artifact_type,
    source_type: row.source_type,
    target_identifier: row.target_identifier ?? null,
    source_label: row.source_label ?? null,
    collector_type: row.collector_type ?? null,
    collector_version: row.collector_version ?? null,
    collected_at: row.collected_at ?? null,
    created_at: row.created_at,
    created_at_label: formatRunTimestamp(row.created_at),
    status: row.status,
    is_incomplete: Boolean(row.is_incomplete),
    incomplete_reason: row.incomplete_reason,
    analysis_error: row.analysis_error,
    model_used: row.model_used,
    tokens_used: row.tokens_used,
    duration_ms: row.duration_ms,
    severity_counts: deriveSeverityCounts(row.report_json),
    report: row.report_json ? JSON.parse(row.report_json) : null,
    environment: row.environment_json
      ? JSON.parse(row.environment_json)
      : null,
    noise: row.noise_json ? JSON.parse(row.noise_json) : null,
    pre_findings: row.pre_findings_json
      ? JSON.parse(row.pre_findings_json)
      : null,
  };

  return <RunDetailClient run={run} />;
}
