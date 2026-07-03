import { describe, it, expect } from "vitest";
import {
  selectableCardVariants,
  resolveCardVariant,
  PRODUCT_CARD_MAX_VARIANT_CHIPS,
} from "./product-card-variants";
import type { ProductVariant } from "@/types/product";

function variant(overrides: Partial<ProductVariant> & { id: string }): ProductVariant {
  return {
    name: "250gms",
    sku: `sku-${overrides.id}`,
    price: 22500,
    compareAtPrice: null,
    isActive: true,
    ...overrides,
  };
}

const v250 = variant({ id: "v1", name: "250gms", price: 22500 });
const v500 = variant({ id: "v2", name: "500gms", price: 42500 });
const v1kg = variant({ id: "v3", name: "1kg", price: 80000 });
const inactive = variant({ id: "v4", name: "5kg", isActive: false });
const unnamed = variant({ id: "v5", name: "" });

describe("product card variant selection", () => {
  it("keeps the API (merchant admin sortOrder) order and drops inactive/unnamed variants", () => {
    const result = selectableCardVariants([v250, inactive, v500, unnamed, v1kg]);
    expect(result.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("resolves the explicitly selected variant so price + Add use that exact variant", () => {
    expect(resolveCardVariant([v250, v500, v1kg], "v2")?.id).toBe("v2");
  });

  it("defaults to the first selectable variant when nothing is selected", () => {
    expect(resolveCardVariant([v250, v500], null)?.id).toBe("v1");
  });

  it("ignores a stale selection pointing at an inactive variant", () => {
    expect(resolveCardVariant([v250, inactive, v500], "v4")?.id).toBe("v1");
  });

  it("falls back to the first active, then first variant, for defensive rendering", () => {
    expect(resolveCardVariant([unnamed], null)?.id).toBe("v5");
    expect(resolveCardVariant([inactive], null)?.id).toBe("v4");
    expect(resolveCardVariant([], null)).toBeUndefined();
  });

  it("caps card chips at 4 with the rest behind a +N link", () => {
    expect(PRODUCT_CARD_MAX_VARIANT_CHIPS).toBe(4);
  });
});
