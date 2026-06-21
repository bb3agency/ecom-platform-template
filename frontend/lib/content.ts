/**
 * content.ts — per-client COPY / CONTENT (design layer, excluded from core sync).
 *
 * `lib/constants.ts` holds brand IDENTITY (name, logo, storage prefix); THIS file
 * holds client-specific PROSE (taglines, blurbs, product-attribute defaults). Core
 * components import from here so they stay content-agnostic — a sweets shop and a
 * produce shop run the same components with different copy. Each client edits this
 * file; core never hardcodes marketing copy. (Configuration-driven content — guide §1.1.)
 *
 * Keep this NEUTRAL in the template. Each client overrides with their own voice.
 */
export const STORE_TAGLINE =
  "Quality products you can trust, delivered to your door.";
export const STORE_TAGLINE_SHORT = "Quality products, delivered";
export const HEADER_PROMO = "Shop our latest products today!";
export const CART_EMPTY_BLURB =
  "Add some products to your cart and come back here to complete your order.";

/** Product-detail attribute defaults (shown when a product has no explicit value). */
export const PRODUCT_ORIGIN_DEFAULT = "India";
export const PRODUCT_CERTIFICATION_DEFAULT = "Quality assured";

/** Homepage SEO description. */
export const HOME_META_DESCRIPTION =
  "Quality products you can trust, delivered to your door.";
