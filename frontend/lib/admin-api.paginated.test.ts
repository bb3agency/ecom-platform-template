import { describe, expect, it } from "vitest";
import {
  coercePaginatedResponse,
  ensureArray,
  getPaginatedItems,
  readPaginatedItems,
} from "@/lib/admin-api";

describe("ensureArray", () => {
  it("returns arrays unchanged", () => {
    const arr = [1, 2];
    expect(ensureArray(arr)).toBe(arr);
  });

  it("returns [] for non-arrays", () => {
    expect(ensureArray(null)).toEqual([]);
    expect(ensureArray({ items: [] })).toEqual([]);
  });
});

describe("getPaginatedItems", () => {
  it("returns items from a paginated admin response", () => {
    const response = {
      items: [{ id: "c1", name: "Spices", slug: "spices" }],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    };
    expect(getPaginatedItems(response)).toEqual(response.items);
  });

  it("returns the array when already unwrapped", () => {
    const items = [{ id: "c1", name: "Spices", slug: "spices" }];
    expect(getPaginatedItems(items)).toBe(items);
  });

  it("returns an empty array when items is missing or not an array", () => {
    expect(getPaginatedItems({ meta: { page: 1, limit: 20, total: 0, totalPages: 0 } } as never)).toEqual(
      [],
    );
    expect(getPaginatedItems(null)).toEqual([]);
    expect(
      getPaginatedItems({
        items: "not-an-array",
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      } as never),
    ).toEqual([]);
  });

  it("unwraps flat paginated responses", () => {
    expect(
      getPaginatedItems({
        items: [{ id: "1" }],
        page: 2,
        limit: 10,
        total: 15,
      }),
    ).toEqual([{ id: "1" }]);
  });
});

describe("readPaginatedItems", () => {
  it("returns [] for null state", () => {
    expect(readPaginatedItems(null)).toEqual([]);
  });
});

describe("coercePaginatedResponse", () => {
  it("preserves meta from standard paginated responses", () => {
    const response = {
      items: [{ id: "a" }],
      meta: { page: 3, limit: 50, total: 120, totalPages: 3 },
    };
    expect(coercePaginatedResponse(response)).toEqual(response);
  });

  it("builds meta from flat paginated responses", () => {
    const result = coercePaginatedResponse({
      items: [{ id: "a" }, { id: "b" }],
      page: 1,
      limit: 20,
      total: 2,
    });
    expect(result.items).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it("recovers when the whole paginated object was stored as items", () => {
    const wronglyNested = {
      items: [{ id: "c1", name: "Spices", slug: "spices" }],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    };
    const result = coercePaginatedResponse(wronglyNested as never);
    expect(result.items).toEqual(wronglyNested.items);
  });
});
