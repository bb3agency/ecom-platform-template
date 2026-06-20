import { describe, expect, it } from "vitest";
import {
  buildAdminQuery,
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
  it("formats start and end of day in UTC Z suffix", () => {
    expect(toIsoDateRange("2026-06-01")).toBe("2026-06-01T00:00:00.000Z");
    expect(toIsoDateRange("2026-06-01", true)).toBe("2026-06-01T23:59:59.999Z");
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
