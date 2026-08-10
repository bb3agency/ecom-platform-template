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

/**
 * The rate the admin EXPLICITLY stored on the product (attributes.gstRate), or
 * null when none was ever set. Distinguishing "explicitly 0" from "absent" is
 * load-bearing: 0 means a NIL-rated good and must be honoured, absent means the
 * platform default applies.
 */
export function readExplicitGstRatePercentFromProductAttributes(attributes: unknown): number | null {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return null;
  }
  const rawRate = (attributes as Record<string, unknown>).gstRate;
  if (typeof rawRate !== 'number' || Number.isNaN(rawRate)) {
    return null;
  }
  if (rawRate > 0 && rawRate < 1) {
    return Math.round(rawRate * 100);
  }
  if (rawRate <= 0) {
    return 0;
  }
  return Math.round(rawRate);
}

export function readGstRatePercentFromProductAttributes(attributes: unknown): number {
  return readExplicitGstRatePercentFromProductAttributes(attributes) ?? DEFAULT_GST_RATE_PERCENT;
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

/**
 * GST 2.0 (22 Sept 2025) abolished the 12% and 28% slabs for goods. A variant
 * stamp holding one of them CANNOT be a current admin choice — the stamp is
 * always rewritten from product attributes on save (syncVariantTaxFieldsFromProduct),
 * so an explicit dead-slab entry would surface through the attributes branch
 * below, never this one. A dead-slab stamp with NO explicit attribute rate is a
 * relic of the pre-GST-2.0 default (12) and must not be billed.
 */
const GST2_DEAD_SLAB_STAMPS = new Set([12, 28]);

/**
 * Effective GST rate for a line item.
 *
 * Precedence (reordered 2026-08-10): the admin's EXPLICIT product rate
 * (attributes.gstRate — what the product editor shows and saves) wins over the
 * variant's stamped copy. The stamp is a denormalisation that can go stale
 * (products saved before the GST-rate editor existed carry the legacy 12%
 * default), and letting it win made the invoice tax a ₹650 line at 12% while
 * the editor showed 5% — the calculation, not just the label, was wrong.
 */
export function resolveLineItemGstRatePercent(
  variantGstRatePercent: number | null | undefined,
  productAttributes: unknown
): number {
  const explicit = readExplicitGstRatePercentFromProductAttributes(productAttributes);
  if (explicit !== null) {
    return explicit;
  }
  if (
    typeof variantGstRatePercent === 'number' &&
    variantGstRatePercent > 0 &&
    !GST2_DEAD_SLAB_STAMPS.has(variantGstRatePercent)
  ) {
    return variantGstRatePercent;
  }
  return DEFAULT_GST_RATE_PERCENT;
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
