import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api";
import {
  buildStorefrontSearchPath,
  emptyStorefrontSearchResults,
  hasStorefrontSearchResults,
  normalizeStorefrontSearchQuery,
  searchStorefrontCatalog,
  STOREFRONT_SEARCH_MIN_CHARS,
} from "@/lib/storefront-search";

vi.mock("@/lib/api", () => ({
  apiClient: vi.fn(),
}));

describe("storefront-search", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires at least two characters before searching", () => {
    expect(STOREFRONT_SEARCH_MIN_CHARS).toBe(2);
  });

  it("normalizes whitespace in queries", () => {
    expect(normalizeStorefrontSearchQuery("  organic   honey  ")).toBe(
      "organic honey",
    );
  });

  it("builds stable search URLs", () => {
    expect(buildStorefrontSearchPath("organic honey")).toBe(
      "/search?q=organic%20honey",
    );
    expect(buildStorefrontSearchPath("   ")).toBe("/search");
  });

  it("returns empty results for short preview queries", async () => {
    await expect(searchStorefrontCatalog("a")).resolves.toEqual(
      emptyStorefrontSearchResults(),
    );
    expect(apiClient).not.toHaveBeenCalled();
  });

  it("returns partial results when one API call fails", async () => {
    vi.mocked(apiClient)
      .mockResolvedValueOnce({
        items: [
          {
            id: "p1",
            name: "Organic Honey",
            slug: "organic-honey",
            description: "",
            category: { id: "c1", name: "Pantry", slug: "pantry" },
            tags: [],
            isFeatured: false,
            isActive: true,
            images: [],
            variants: [
              {
                id: "v1",
                name: "Default",
                sku: "HNY",
                price: 5000,
                compareAtPrice: null,
                isActive: true,
              },
            ],
            inStock: true,
          },
        ],
        meta: { page: 1, limit: 6, total: 1, totalPages: 1 },
      })
      .mockRejectedValueOnce(new Error("categories unavailable"));

    const result = await searchStorefrontCatalog("honey");
    expect(result.products).toHaveLength(1);
    expect(result.productTotal).toBe(1);
    expect(result.categories).toEqual([]);
  });

  it("detects when preview results exist", () => {
    expect(hasStorefrontSearchResults(null)).toBe(false);
    expect(hasStorefrontSearchResults(emptyStorefrontSearchResults())).toBe(
      false,
    );
    expect(
      hasStorefrontSearchResults({
        products: [
          {
            id: "p1",
            name: "Honey",
            slug: "honey",
            description: "",
            category: { id: "c1", name: "Pantry", slug: "pantry" },
            rating: 0,
            reviewCount: 0,
            tags: [],
            isFeatured: false,
            isActive: true,
            images: [],
            variants: [],
            inStock: true,
          },
        ],
        categories: [],
        productTotal: 1,
      }),
    ).toBe(true);
    expect(
      hasStorefrontSearchResults({
        products: [],
        categories: [{ id: "c1", name: "Fruits", slug: "fruits" }],
        productTotal: 0,
      }),
    ).toBe(true);
  });
});
