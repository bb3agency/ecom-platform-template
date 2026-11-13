/**
 * Pure state logic behind hooks/use-admin-list.ts — kept React-free so the
 * page-reset, URL and stale-response rules are unit-tested in lib/admin-list.test.ts.
 *
 * Rules every admin list follows:
 * - Filters (and the page) are mirrored to the URL query string, replacing — not
 *   pushing — history entries, so a refresh, Back or a dashboard deep link
 *   (`/admin/orders?status=CONFIRMED`) lands on the same view.
 * - Changing any filter returns to page 1 in the SAME state update, so there is
 *   never a fetch for "new filter, old page" (which used to flash wrong rows or
 *   an empty page 3).
 * - Only the latest request may write state (lib/request-sequence.ts).
 */
import {
  coercePaginatedResponse,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";
import type { RequestSequence } from "@/lib/request-sequence";
import { readFilterParam } from "@/lib/url-filter-params";

export type AdminListFilters = Record<string, string>;

export interface AdminListFilterSpec {
  defaultValue: string;
  /** Accepted URL values; anything else falls back to `defaultValue`. */
  allowed?: readonly string[];
  /**
   * Query-string key. Defaults to the filter's own name; `false` keeps the value
   * local (free-text search, which would otherwise churn the URL per keystroke).
   */
  param?: string | false;
}

export type AdminListFilterSpecs<F extends AdminListFilters> = {
  [K in keyof F]: AdminListFilterSpec;
};

export interface AdminListQuery<F extends AdminListFilters> {
  filters: F;
  page: number;
}

/** Default query-string key for the page number; `false` disables page sync. */
export const ADMIN_LIST_PAGE_PARAM = "page";

function paramFor(key: string, spec: AdminListFilterSpec): string | null {
  if (spec.param === false) return null;
  return spec.param ?? key;
}

/** A positive integer page from the URL, else 1. */
export function parsePageParam(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

/** Initial query from `location.search` (or "" on the server). */
export function readAdminListQuery<F extends AdminListFilters>(
  specs: AdminListFilterSpecs<F>,
  search: string,
  pageParam: string | false = ADMIN_LIST_PAGE_PARAM,
): AdminListQuery<F> {
  const filters = {} as F;
  for (const key of Object.keys(specs) as (keyof F & string)[]) {
    const spec = specs[key];
    const param = paramFor(key, spec);
    filters[key] = (
      param === null ? spec.defaultValue : readFilterParam(search, param, spec.defaultValue, spec.allowed)
    ) as F[typeof key];
  }
  const page = pageParam === false ? 1 : parsePageParam(new URLSearchParams(search).get(pageParam));
  return { filters, page };
}

/**
 * Apply a filter change. Any actual change returns to page 1; a no-op patch
 * returns the same object so React skips the re-render and the refetch.
 */
export function applyFilterPatch<F extends AdminListFilters>(
  query: AdminListQuery<F>,
  patch: Partial<F>,
): AdminListQuery<F> {
  let changed = false;
  const filters = { ...query.filters };
  for (const key of Object.keys(patch) as (keyof F & string)[]) {
    const value = patch[key];
    if (value === undefined || filters[key] === value) continue;
    filters[key] = value;
    changed = true;
  }
  return changed ? { filters, page: 1 } : query;
}

/** Move to `page` (clamped to ≥ 1), keeping the filters. */
export function applyPageChange<F extends AdminListFilters>(
  query: AdminListQuery<F>,
  page: number,
): AdminListQuery<F> {
  const next = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return next === query.page ? query : { ...query, page: next };
}

/** `href` rewritten with the list's filters/page; defaults are dropped, other params kept. */
export function writeAdminListQuery<F extends AdminListFilters>(
  href: string,
  specs: AdminListFilterSpecs<F>,
  query: AdminListQuery<F>,
  pageParam: string | false = ADMIN_LIST_PAGE_PARAM,
): string {
  const url = new URL(href);
  const write = (param: string, value: string, defaultValue: string) => {
    if (value === defaultValue || value === "") url.searchParams.delete(param);
    else url.searchParams.set(param, value);
  };
  for (const key of Object.keys(specs) as (keyof F & string)[]) {
    const spec = specs[key];
    const param = paramFor(key, spec);
    if (param !== null) write(param, query.filters[key], spec.defaultValue);
  }
  if (pageParam !== false) write(pageParam, String(query.page), "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

// ── Loading / error / empty state ───────────────────────────────────────────

export interface AdminListLoadState<T> {
  data: PaginatedResponse<T> | null;
  loading: boolean;
  error: string | null;
}

export const INITIAL_ADMIN_LIST_LOAD_STATE: AdminListLoadState<never> = {
  data: null,
  loading: true,
  error: null,
};

/**
 * - `loading`: first load, nothing to show yet (render a skeleton).
 * - `error`:   the latest request failed (render the message + retry).
 * - `empty`:   loaded, zero rows (render the empty state).
 * - `ready`:   rows to show (a refetch may be in flight: `loading` stays true).
 */
export type AdminListStatus = "loading" | "error" | "empty" | "ready";

export function adminListStatus<T>(state: AdminListLoadState<T>): AdminListStatus {
  if (state.error) return "error";
  if (state.data === null) return state.loading ? "loading" : "empty";
  if (readPaginatedItems(state.data).length === 0) return state.loading ? "loading" : "empty";
  return "ready";
}

/**
 * Run one list request. Only the latest request (per `sequence`) may write
 * state: an older response — or an older failure — is dropped silently.
 * A failure clears `data` so the list never shows rows that don't match the
 * filters on screen.
 */
export async function runAdminListRequest<T>(
  sequence: RequestSequence,
  fetcher: () => Promise<unknown>,
  update: (patch: Partial<AdminListLoadState<T>>) => void,
  toErrorMessage: (err: unknown) => string,
): Promise<void> {
  const ticket = sequence.begin();
  update({ loading: true, error: null });
  try {
    const response = await fetcher();
    if (!sequence.isLatest(ticket)) return;
    update({ data: coercePaginatedResponse<T>(response), loading: false });
  } catch (err) {
    if (!sequence.isLatest(ticket)) return;
    update({ data: null, error: toErrorMessage(err), loading: false });
  }
}
