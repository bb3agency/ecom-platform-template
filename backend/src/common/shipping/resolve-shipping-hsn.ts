/** Shiprocket requires numeric HSN codes, 1–15 digits. */
const SHIPPING_HSN_PATTERN = /^[0-9]{1,15}$/;

/** Generic food-preparation HSN used when products omit a code (override via DEFAULT_SHIPPING_HSN). */
export const DEFAULT_SHIPPING_HSN_FALLBACK = '2106';

export function isValidShippingHsn(value: string): boolean {
  return SHIPPING_HSN_PATTERN.test(value);
}

export function normalizeShippingHsn(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return isValidShippingHsn(trimmed) ? trimmed : null;
}

export function resolveDefaultShippingHsn(
  env: Record<string, string | undefined> = process.env
): string {
  const fromEnv = (env.DEFAULT_SHIPPING_HSN ?? '').trim();
  if (isValidShippingHsn(fromEnv)) {
    return fromEnv;
  }
  return DEFAULT_SHIPPING_HSN_FALLBACK;
}

function readProductAttributeHsn(productAttributes: unknown): string | null {
  if (!productAttributes || typeof productAttributes !== 'object' || Array.isArray(productAttributes)) {
    return null;
  }
  return normalizeShippingHsn((productAttributes as Record<string, unknown>).hsnCode);
}

/** Returns a product/variant HSN when explicitly configured; never applies the shipping default. */
export function resolveExplicitShippingHsn(sources: {
  variantHsnCode?: string | null | undefined;
  productAttributes?: unknown;
}): string | null {
  const variantHsn = normalizeShippingHsn(sources.variantHsnCode);
  if (variantHsn) {
    return variantHsn;
  }
  return readProductAttributeHsn(sources.productAttributes);
}

/** Resolves HSN for carrier payloads; falls back to DEFAULT_SHIPPING_HSN when product data is missing/invalid. */
export function resolveShippingHsnCode(sources: {
  variantHsnCode?: string | null | undefined;
  productAttributes?: unknown;
  defaultHsn?: string;
}): string {
  const explicit = resolveExplicitShippingHsn(sources);
  if (explicit) {
    return explicit;
  }
  const fallback = sources.defaultHsn ?? resolveDefaultShippingHsn();
  return isValidShippingHsn(fallback) ? fallback : DEFAULT_SHIPPING_HSN_FALLBACK;
}
