/** Client-side mirrors of backend FEATURE_* flags. Prefer useStoreConfig() on the storefront. */

function readOptInFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export const GST_INVOICING_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED?.trim().toLowerCase() !== "false";

export const WISHLIST_ENABLED = readOptInFlag(
  process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED,
);

/** @deprecated Use `useStoreConfig().couponsEnabled` — merchant toggles in Admin → Coupons. */
export const COUPONS_ENABLED = readOptInFlag(
  process.env.NEXT_PUBLIC_FEATURE_COUPONS_ENABLED,
);

export const REVIEWS_ENABLED = readOptInFlag(
  process.env.NEXT_PUBLIC_FEATURE_REVIEWS_ENABLED,
);
