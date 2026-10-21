"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { getOpsOverviewClient, isOpsUnauthorisedError, type OpsOverview } from "@/lib/ops-client-api";

interface UseOpsOverviewResult {
  overview: OpsOverview | null;
  error: string | null;
  /** True on the first load only; refreshes keep the current data on screen. */
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
}

/** `GET /ops/overview`, shared by the overview, queues and restart screens. */
export function useOpsOverview(pollMs?: number): UseOpsOverviewResult {
  const router = useRouter();
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setOverview(await getOpsOverviewClient());
      setError(null);
    } catch (err) {
      if (isOpsUnauthorisedError(err)) {
        router.replace("/ops/login");
        return;
      }
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    const timer = pollMs ? window.setInterval(() => void reload(), pollMs) : undefined;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [reload, pollMs]);

  return { overview, error, loading, refreshing, reload };
}
