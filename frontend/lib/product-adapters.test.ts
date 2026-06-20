import { describe, expect, it } from "vitest";
import { mapProduct } from "@/lib/product-adapters";

describe("mapProduct", () => {
  it("derives rating and reviewCount from embedded reviews", () => {
    const product = mapProduct({
      id: "product_1",
      name: "Organic Ghee",
      slug: "organic-ghee",
      reviews: [
        { rating: 5 },
        { rating: 3 },
        { rating: 4 },
      ],
    });

    expect(product.reviewCount).toBe(3);
    expect(product.rating).toBe(4);
  });

  it("falls back to API fields when reviews array is absent", () => {
    const product = mapProduct({
      id: "product_2",
      name: "Honey",
      slug: "honey",
      rating: 4.5,
      reviewCount: 12,
    });

    expect(product.rating).toBe(4.5);
    expect(product.reviewCount).toBe(12);
  });
});
