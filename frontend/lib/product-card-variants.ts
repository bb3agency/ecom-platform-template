import type { ProductVariant } from "@/types/product";

/** Max variant chips rendered on a product card; the rest collapse into a "+N" link. */
export const PRODUCT_CARD_MAX_VARIANT_CHIPS = 4;

/**
 * Variants a customer can pick directly on a product card, in the order the
 * API returns them — the backend sorts by the merchant's admin `sortOrder`
 * (then price), so the card mirrors the admin panel ordering exactly.
 */
export function selectableCardVariants(variants: ProductVariant[]): ProductVariant[] {
  return variants.filter((v) => v.isActive && Boolean(v.name));
}

/**
 * Resolves the variant a card should price/add: the explicitly selected one if
 * it is still selectable, else the first selectable variant, else the first
 * active variant, else the first variant at all (defensive for bad data).
 */
export function resolveCardVariant(
  variants: ProductVariant[],
  selectedVariantId: string | null,
): ProductVariant | undefined {
  const selectable = selectableCardVariants(variants);
  return (
    selectable.find((v) => v.id === selectedVariantId) ??
    selectable[0] ??
    variants.find((v) => v.isActive) ??
    variants[0]
  );
}
