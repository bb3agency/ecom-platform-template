"use client";

import { useCallback, useEffect, useState } from "react";
import { coercePaginatedResponse, type PaginatedResponse } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";

interface UseAdminListResourceResult<T> {
  data: PaginatedResponse<T> | null;
  loading: boolean;
  error: string | null;
  page: number;
  setPage: (page: number) => void;
  reload: () => void;
}

export function useAdminListResource<T>(
  fetchPage: (page: number) => Promise<unknown>,
): UseAdminListResourceResult<T> {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse<T> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchPage(page);
        if (!cancelled) {
          setData(coercePaginatedResponse(response));
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, page, reloadToken]);

  return { data, loading, error, page, setPage, reload };
}
