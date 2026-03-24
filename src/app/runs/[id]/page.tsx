import { notFound } from "next/navigation";
import { RunDetailClient } from "./run-detail-client";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

interface RunDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;
  const storage = await getStorage();
  const run = await storage.runs.getPageDetail(id);
  if (!run) notFound();

  return <RunDetailClient run={run} />;
}
