import { describe, expect, it } from "vitest";

import {
  INITIAL_ADMIN_LIST_LOAD_STATE,
  adminListStatus,
  applyFilterPatch,
  applyPageChange,
  parsePageParam,
  readAdminListQuery,
  runAdminListRequest,
  writeAdminListQuery,
  type AdminListFilterSpecs,
  type AdminListLoadState,
  type AdminListQuery,
} from "@/lib/admin-list";
import { createRequestSequence } from "@/lib/request-sequence";

type OrderFilters = { status: string; sort: string; search: string };

const SPECS: AdminListFilterSpecs<OrderFilters> = {
  status: { defaultValue: "", allowed: ["CONFIRMED", "SHIPPED"] },
  sort: { defaultValue: "newest", allowed: ["newest", "oldest"], param: "order" },
  search: { defaultValue: "", param: false },
};

const page = (n: number, items: string[] = ["row"]) => ({
  items,
  meta: { page: n, limit: 20, total: items.length, totalPages: 1 },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Collects the state a list would render, the way the hook's setState does. */
function stateRecorder<T>() {
  let state: AdminListLoadState<T> = INITIAL_ADMIN_LIST_LOAD_STATE;
  return {
    update: (patch: Partial<AdminListLoadState<T>>) => {
      state = { ...state, ...patch };
    },
    get: () => state,
  };
}

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "failed");

describe("readAdminListQuery", () => {
  it("reads allowed filter values and the page from the URL", () => {
    expect(readAdminListQuery(SPECS, "?status=SHIPPED&order=oldest&page=3")).toEqual({
      filters: { status: "SHIPPED", sort: "oldest", search: "" },
      page: 3,
    });
  });

  it("falls back to defaults for unknown values and ignores local-only filters", () => {
    expect(readAdminListQuery(SPECS, "?status=BOGUS&search=abc&page=-2")).toEqual({
      filters: { status: "", sort: "newest", search: "" },
      page: 1,
    });
  });

  it("ignores the page param when page sync is off", () => {
    expect(readAdminListQuery(SPECS, "?page=4", false).page).toBe(1);
  });
});

describe("parsePageParam", () => {
  it.each([
    [null, 1],
    ["", 1],
    ["0", 1],
    ["2.5", 1],
    ["abc", 1],
    ["7", 7],
  ])("%s → %d", (input, expected) => {
    expect(parsePageParam(input)).toBe(expected);
  });
});

describe("applyFilterPatch", () => {
  const onPage4: AdminListQuery<OrderFilters> = {
    filters: { status: "", sort: "newest", search: "" },
    page: 4,
  };

  it("resets to page 1 in the same update as the filter change", () => {
    expect(applyFilterPatch(onPage4, { status: "SHIPPED" })).toEqual({
      filters: { status: "SHIPPED", sort: "newest", search: "" },
      page: 1,
    });
  });

  it("applies several filters at once with a single reset", () => {
    const next = applyFilterPatch(onPage4, { search: "rice", sort: "oldest" });
    expect(next.page).toBe(1);
    expect(next.filters).toEqual({ status: "", sort: "oldest", search: "rice" });
  });

  it("returns the same object for a no-op change, keeping the page", () => {
    expect(applyFilterPatch(onPage4, { status: "" })).toBe(onPage4);
    expect(applyFilterPatch(onPage4, {})).toBe(onPage4);
  });

  it("does not mutate the previous query", () => {
    applyFilterPatch(onPage4, { status: "SHIPPED" });
    expect(onPage4.filters.status).toBe("");
    expect(onPage4.page).toBe(4);
  });
});

describe("applyPageChange", () => {
  const query: AdminListQuery<OrderFilters> = { filters: { status: "", sort: "newest", search: "" }, page: 2 };

  it("moves pages and keeps filters", () => {
    expect(applyPageChange(query, 5)).toEqual({ ...query, page: 5 });
  });

  it("clamps invalid pages to 1 and is a no-op for the current page", () => {
    expect(applyPageChange(query, 0).page).toBe(1);
    expect(applyPageChange(query, Number.NaN).page).toBe(1);
    expect(applyPageChange(query, 2)).toBe(query);
  });
});

describe("writeAdminListQuery", () => {
  it("writes non-default filters and the page, keeping unrelated params and the hash", () => {
    const href = writeAdminListQuery(
      "https://shop.test/admin/orders?range=all#top",
      SPECS,
      { filters: { status: "SHIPPED", sort: "oldest", search: "rice" }, page: 2 },
    );
    const url = new URL(href, "https://shop.test");
    expect(url.pathname).toBe("/admin/orders");
    expect(url.hash).toBe("#top");
    expect(url.searchParams.get("range")).toBe("all");
    expect(url.searchParams.get("status")).toBe("SHIPPED");
    expect(url.searchParams.get("order")).toBe("oldest");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("search")).toBe(false);
  });

  it("drops defaults and page 1 so URLs stay short", () => {
    expect(
      writeAdminListQuery("https://shop.test/admin/orders?status=SHIPPED&page=3", SPECS, {
        filters: { status: "", sort: "newest", search: "" },
        page: 1,
      }),
    ).toBe("/admin/orders");
  });

  it("round-trips through readAdminListQuery", () => {
    const query: AdminListQuery<OrderFilters> = { filters: { status: "CONFIRMED", sort: "oldest", search: "" }, page: 6 };
    const href = writeAdminListQuery("https://shop.test/admin/orders", SPECS, query);
    expect(readAdminListQuery(SPECS, new URL(href, "https://shop.test").search)).toEqual(query);
  });
});

describe("adminListStatus", () => {
  it("is loading before the first response", () => {
    expect(adminListStatus(INITIAL_ADMIN_LIST_LOAD_STATE)).toBe("loading");
  });

  it("is empty when a load finishes with no rows", () => {
    expect(adminListStatus({ data: page(1, []), loading: false, error: null })).toBe("empty");
  });

  it("stays ready (not loading) while refetching with rows on screen", () => {
    expect(adminListStatus({ data: page(1), loading: true, error: null })).toBe("ready");
  });

  it("reports error over everything else", () => {
    expect(adminListStatus({ data: null, loading: false, error: "Nope" })).toBe("error");
  });
});

describe("runAdminListRequest", () => {
  it("stores the response and clears loading", async () => {
    const recorder = stateRecorder<string>();
    await runAdminListRequest<string>(createRequestSequence(), async () => page(1, ["a", "b"]), recorder.update, toMessage);
    expect(recorder.get()).toEqual({ data: page(1, ["a", "b"]), loading: false, error: null });
  });

  it("drops a stale response that resolves after a newer one", async () => {
    const sequence = createRequestSequence();
    const recorder = stateRecorder<string>();
    const slowOldPage = deferred<unknown>();

    // Filter changed on page 3: the old request is still in flight when the new one starts.
    const older = runAdminListRequest<string>(sequence, () => slowOldPage.promise, recorder.update, toMessage);
    await runAdminListRequest<string>(sequence, async () => page(1, ["new"]), recorder.update, toMessage);
    slowOldPage.resolve(page(3, ["old"]));
    await older;

    expect(recorder.get().data?.items).toEqual(["new"]);
    expect(recorder.get().loading).toBe(false);
  });

  it("keeps loading true while a newer request is still in flight", async () => {
    const sequence = createRequestSequence();
    const recorder = stateRecorder<string>();
    const newer = deferred<unknown>();

    const first = runAdminListRequest<string>(sequence, async () => page(1, ["old"]), recorder.update, toMessage);
    const second = runAdminListRequest<string>(sequence, () => newer.promise, recorder.update, toMessage);
    await first;
    expect(recorder.get().loading).toBe(true);
    expect(recorder.get().data).toBeNull();

    newer.resolve(page(2, ["new"]));
    await second;
    expect(recorder.get()).toMatchObject({ loading: false, data: page(2, ["new"]) });
  });

  it("sets the error message and clears rows when the latest request fails", async () => {
    const sequence = createRequestSequence();
    const recorder = stateRecorder<string>();
    await runAdminListRequest<string>(sequence, async () => page(1, ["a"]), recorder.update, toMessage);
    await runAdminListRequest<string>(
      sequence,
      async () => {
        throw new Error("Couldn't reach the server");
      },
      recorder.update,
      toMessage,
    );
    expect(recorder.get()).toEqual({ data: null, loading: false, error: "Couldn't reach the server" });
    expect(adminListStatus(recorder.get())).toBe("error");
  });

  it("drops a stale failure so it can't overwrite newer rows", async () => {
    const sequence = createRequestSequence();
    const recorder = stateRecorder<string>();
    const olderFails = deferred<unknown>();

    const older = runAdminListRequest<string>(sequence, () => olderFails.promise, recorder.update, toMessage);
    await runAdminListRequest<string>(sequence, async () => page(1, ["fresh"]), recorder.update, toMessage);
    olderFails.reject(new Error("timeout"));
    await older;

    expect(recorder.get()).toEqual({ data: page(1, ["fresh"]), loading: false, error: null });
  });

  it("clears a previous error when a retry starts", async () => {
    const sequence = createRequestSequence();
    const recorder = stateRecorder<string>();
    recorder.update({ error: "Earlier failure", loading: false });
    const retry = deferred<unknown>();
    const pending = runAdminListRequest<string>(sequence, () => retry.promise, recorder.update, toMessage);
    expect(recorder.get()).toMatchObject({ error: null, loading: true });
    retry.resolve(page(1));
    await pending;
    expect(adminListStatus(recorder.get())).toBe("ready");
  });
});
