"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { useRequestSequence } from "@/hooks/use-request-sequence";
import { readPaginatedItems, type PaginatedResponse } from "@/lib/admin-api";
import type { AdminDataScope } from "@/lib/admin-data-refresh";
import {
  ADMIN_LIST_PAGE_PARAM,
  INITIAL_ADMIN_LIST_LOAD_STATE,
  adminListStatus,
  applyFilterPatch,
  applyPageChange,
  readAdminListQuery,
  runAdminListRequest,
  writeAdminListQuery,
  type AdminListFilterSpecs,
  type AdminListFilters,
  type AdminListLoadState,
  type AdminListQuery,
  type AdminListStatus,
} from "@/lib/admin-list";
import { getApiErrorMessage } from "@/lib/error-messages";

export interface UseAdminListOptions<F extends AdminListFilters> {
  /** Filter definitions. Read once on mount — keep them static. */
  filters: AdminListFilterSpecs<F>;
  /**
   * Fetch one page. Must be memoised (`useCallback`): a new identity refetches.
   * Put values that live outside the hook (date range, …) in its deps AND in `resetKey`.
   */
  fetchPage: (query: AdminListQuery<F>) => Promise<unknown>;
  /** Data scopes whose `notifyAdminDataChanged` should refetch this list. */
  refreshScopes: AdminDataScope | AdminDataScope[];
  /** Values outside the hook (e.g. the page date range) that also return the list to page 1. */
  resetKey?: string;
  /** Query-string key for the page number; `false` keeps it out of the URL. */
  pageParam?: string | false;
}

export interface UseAdminListResult<T, F extends AdminListFilters> {
  filters: F;
  /** Set one filter; any change returns to page 1 in the same update. */
  setFilter: <K extends keyof F>(key: K, value: F[K]) => void;
  /** Set several filters at once (e.g. "Clear"); one page-1 reset, one fetch. */
  setFilters: (patch: Partial<F>) => void;
  page: number;
  setPage: (page: number) => void;
  data: PaginatedResponse<T> | null;
  items: T[];
  /** True while any request is in flight (first load or refetch). */
  loading: boolean;
  error: string | null;
  status: AdminListStatus;
  /** Refetch the current page; resolves when the (latest) request settles. */
  reload: () => Promise<void>;
}

/**
 * Shared state for paginated admin lists: URL-synced filters + page, page reset
 * on filter change, last-request-wins loading, and loading/empty/error states.
 * Rules and tests live in lib/admin-list.ts.
 */
export function useAdminList<T, F extends AdminListFilters>({
  filters: specs,
  fetchPage,
  refreshScopes,
  resetKey = "",
  pageParam = ADMIN_LIST_PAGE_PARAM,
}: UseAdminListOptions<F>): UseAdminListResult<T, F> {
  // Specs and the page key are read once — a list's filter shape never changes.
  const [config] = useState(() => ({ specs, pageParam }));

  // Admin lists render only after the client-side session gate, so reading
  // `window.location` in the initializer cannot cause a hydration mismatch.
  const [query, setQuery] = useState<AdminListQuery<F>>(() =>
    readAdminListQuery(config.specs, typeof window === "undefined" ? "" : window.location.search, config.pageParam),
  );

  // A change to outside inputs (date range) resets the page during render, so the
  // fetch below never runs for "new range, old page".
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    setQuery((current) => applyPageChange(current, 1));
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = writeAdminListQuery(window.location.href, config.specs, query, config.pageParam);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(window.history.state, "", next);
  }, [config, query]);

  const setFilters = useCallback((patch: Partial<F>) => {
    setQuery((current) => applyFilterPatch(current, patch));
  }, []);
  const setFilter = useCallback(
    <K extends keyof F>(key: K, value: F[K]) => {
      const patch: Partial<F> = {};
      patch[key] = value;
      setFilters(patch);
    },
    [setFilters],
  );
  const setPage = useCallback((page: number) => {
    setQuery((current) => applyPageChange(current, page));
  }, []);

  const [state, setState] = useState<AdminListLoadState<T>>(INITIAL_ADMIN_LIST_LOAD_STATE);
  const sequence = useRequestSequence();
  const reload = useCallback(
    () =>
      runAdminListRequest<T>(
        sequence,
        () => fetchPage(query),
        (patch) => setState((current) => ({ ...current, ...patch })),
        getApiErrorMessage,
      ),
    [sequence, fetchPage, query],
  );

  useEffect(() => {
    void reload();
  }, [reload]);
  useAdminDataRefreshEffect(reload, refreshScopes);

  return {
    filters: query.filters,
    setFilter,
    setFilters,
    page: query.page,
    setPage,
    data: state.data,
    items: readPaginatedItems(state.data),
    loading: state.loading,
    error: state.error,
    status: adminListStatus(state),
    reload,
  };
}
