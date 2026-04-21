import { DashboardClient } from "./dashboard-client";
import { LivePageRefresh } from "@/components/live-page-refresh";
import { loadDashboardReadModel } from "@/lib/dashboard-read-model";
import { shouldEnableOperatorLiveRefresh } from "@/lib/runtime/vercel-environment";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const storage = await getStorage();
  const model = await loadDashboardReadModel(storage);
  const enableLiveRefresh = shouldEnableOperatorLiveRefresh();

  return (
    <>
      {enableLiveRefresh ? <LivePageRefresh intervalMs={10000} /> : null}
      <DashboardClient {...model} />
    </>
  );
}
