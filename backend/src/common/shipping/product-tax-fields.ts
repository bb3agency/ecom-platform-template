import {
  normalizeShippingHsn,
  resolveExplicitShippingHsn
} from '@common/shipping/resolve-shipping-hsn';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

export const INVOICE_HSN_MISSING_LABEL = 'N/A';

/**
 * Fallback GST rate for products that never set one. 5% is the modal GST 2.0 rate
 * for packaged food/FMCG (this platform's client base). The previous default of
 * 12% became a DEAD SLAB on 22 Sept 2025 — GST 2.0 abolished 12% and 28% for
 * goods, leaving 0/5/18/40 (+3% precious metals, transitional 28%+cess tobacco).
 */
const DEFAULT_GST_RATE_PERCENT = 5;

export function readGstRatePercentFromProductAttributes(attributes: unknown): number {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return DEFAULT_GST_RATE_PERCENT;
  }
  const rawRate = (attributes as Record<string, unknown>).gstRate;
  if (typeof rawRate !== 'number') {
    return DEFAULT_GST_RATE_PERCENT;
  }
  if (rawRate > 0 && rawRate < 1) {
    return Math.round(rawRate * 100);
  }
  if (rawRate <= 0) {
    return 0;
  }
  return Math.round(rawRate);
}

export function resolveVariantTaxFieldsFromProductAttributes(attributes: unknown): {
  hsnCode: string | null;
  gstRatePercent: number;
} {
  return {
    hsnCode: resolveExplicitShippingHsn({ productAttributes: attributes }),
    gstRatePercent: readGstRatePercentFromProductAttributes(attributes)
  };
}

export function resolveLineItemGstRatePercent(
  variantGstRatePercent: number | null | undefined,
  productAttributes: unknown
): number {
  if (typeof variantGstRatePercent === 'number' && variantGstRatePercent > 0) {
    return variantGstRatePercent;
  }
  return readGstRatePercentFromProductAttributes(productAttributes);
}

/** Invoice PDFs require explicit product/variant HSN — never apply shipping defaults. */
export function resolveInvoiceHsnCode(sources: {
  variantHsnCode?: string | null | undefined;
  productAttributes?: unknown;
}): string {
  const explicit = resolveExplicitShippingHsn(sources);
  return explicit ?? INVOICE_HSN_MISSING_LABEL;
}

export function resolveDisplayProductHsn(input: {
  productAttributes?: unknown;
  variantHsnCode?: string | null | undefined;
}): string {
  return resolveExplicitShippingHsn(input) ?? '';
}

export function assertValidProductHsnAttribute(attributes: unknown): void {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return;
  }
  const rawHsn = (attributes as Record<string, unknown>).hsnCode;
  if (rawHsn === undefined || rawHsn === null || rawHsn === '') {
    return;
  }
  if (typeof rawHsn !== 'string' || !normalizeShippingHsn(rawHsn)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'HSN code must be numeric (1-15 digits)', 400);
  }
}
