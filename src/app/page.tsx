import { DashboardClient } from "./dashboard-client";
import { LivePageRefresh } from "@/components/live-page-refresh";
import { loadDashboardReadModel } from "@/lib/dashboard-read-model";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const storage = await getStorage();
  const model = await loadDashboardReadModel(storage);

  return (
    <>
      <LivePageRefresh intervalMs={10000} />
      <DashboardClient {...model} />
    </>
  );
}
