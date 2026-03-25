"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function LivePageRefresh({
  intervalMs = 15000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    const refresh = () => {
      lastRefreshAtRef.current = Date.now();
      router.refresh();
    };

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      refresh();
    };

    const refreshOnFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshAtRef.current < 4000) return;
      refresh();
    };

    const timer = window.setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [intervalMs, router]);

  return null;
}
