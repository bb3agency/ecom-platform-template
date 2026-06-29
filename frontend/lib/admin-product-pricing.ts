import type { AdminProductDetail, AdminProductVariant } from "@/lib/admin-api";

/** Parse a rupee input string into integer paise for the API. */
export function parseRupeesToPaise(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100);
}

export function formatVariantPriceInput(paise: number): string {
  return String(paise / 100);
}

export function formatVariantCompareAtPriceInput(
  compareAtPrice: number | null,
): string {
  // Treat null AND <=0 as "no compare-at price" (0 is legacy corrupt data) so the
  // field shows empty instead of "0" and we don't re-send an invalid 0 on save.
  return compareAtPrice != null && compareAtPrice > 0
    ? String(compareAtPrice / 100)
    : "";
}

export function primaryVariantPricingFromApi(variant: AdminProductVariant): {
  priceRupees: string;
  compareAtPriceRupees: string;
} {
  return {
    priceRupees: formatVariantPriceInput(variant.price),
    compareAtPriceRupees: formatVariantCompareAtPriceInput(
      variant.compareAtPrice,
    ),
  };
}

export type PrimaryVariantPricePatch =
  | { ok: true; price: number; compareAtPrice: number | null }
  | { ok: false; field: "price"; message: string };

/** Build the variant PATCH body used when saving product pricing in edit mode. */
export function buildPrimaryVariantPricePatch(
  priceRupees: string,
  compareAtPriceRupees: string,
): PrimaryVariantPricePatch {
  const price = parseRupeesToPaise(priceRupees);
  if (price === undefined) {
    return {
      ok: false,
      field: "price",
      message: "Price must be a non-negative number (rupees).",
    };
  }

  const compareAtPrice = parseRupeesToPaise(compareAtPriceRupees);
  return {
    ok: true,
    price,
    // <=0 (or blank) means no compare-at price → send null to clear it.
    compareAtPrice: compareAtPrice && compareAtPrice > 0 ? compareAtPrice : null,
  };
}

export function mergePrimaryVariantPrices(
  product: AdminProductDetail,
  variantId: string,
  price: number,
  compareAtPrice: number | null,
): AdminProductDetail {
  return {
    ...product,
    variants: product.variants.map((variant) =>
      variant.id === variantId
        ? { ...variant, price, compareAtPrice }
        : variant,
    ),
  };
}
