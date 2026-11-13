import { describe, expect, it } from "vitest";
import {
  buildAdminQuery,
  buildOrdersExportQuery,
  fetchAllPaginatedItems,
  normalizePagination,
  toIsoDateRange,
  type PaginatedResponse,
} from "@/lib/admin-api";

describe("buildAdminQuery", () => {
  it("builds query string from params", () => {
    expect(buildAdminQuery({ page: 2, limit: 20 })).toBe("?page=2&limit=20");
  });

  it("omits undefined and empty values", () => {
    expect(buildAdminQuery({ page: 1, search: "" })).toBe("?page=1");
  });

  it("serializes boolean params", () => {
    expect(buildAdminQuery({ approved: false })).toBe("?approved=false");
  });

  it("returns empty string when no params", () => {
    expect(buildAdminQuery({})).toBe("");
  });
});

describe("toIsoDateRange", () => {
  // Local-day boundaries: the admin's own midnight, not UTC midnight (which
  // splits an IST day at 05:30).
  it("returns the start of the local day", () => {
    expect(toIsoDateRange("2026-06-01")).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).toISOString());
  });

  it("returns the last millisecond of the local day", () => {
    expect(toIsoDateRange("2026-06-01", true)).toBe(
      new Date(2026, 5, 1, 23, 59, 59, 999).toISOString(),
    );
  });

  it("returns empty for blank or invalid input", () => {
    expect(toIsoDateRange("")).toBe("");
    expect(toIsoDateRange("not-a-date")).toBe("");
  });
});

describe("buildOrdersExportQuery", () => {
  it("uses the same local-day window as the on-screen orders list", () => {
    const query = new URLSearchParams(
      buildOrdersExportQuery({ from: "2026-11-01", to: "2026-11-07" }).slice(1),
    );
    expect(query.get("from")).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).toISOString());
    expect(query.get("to")).toBe(new Date(2026, 10, 7, 23, 59, 59, 999).toISOString());
  });
});

describe("normalizePagination", () => {
  it("returns meta when present", () => {
    expect(
      normalizePagination({
        items: [],
        meta: { page: 2, limit: 10, total: 25, totalPages: 3 },
      }),
    ).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });

  it("derives meta from flat pagination fields", () => {
    expect(
      normalizePagination({ items: [], total: 40, page: 2, limit: 20 }),
    ).toEqual({ page: 2, limit: 20, total: 40, totalPages: 2 });
  });
});

describe("fetchAllPaginatedItems", () => {
  it("pages through results until totalPages is exhausted", async () => {
    const fetchPage = async (
      page: number,
      limit: number,
    ): Promise<PaginatedResponse<{ id: string }>> => ({
      items: [{ id: `row-${page}` }],
      meta: { page, limit, total: 2, totalPages: 2 },
    });

    const items = await fetchAllPaginatedItems(fetchPage, { pageSize: 1 });
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("row-1");
    expect(items[1]?.id).toBe("row-2");
  });
});
