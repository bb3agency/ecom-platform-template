import { describe, expect, it } from 'vitest';
import {
  INVOICE_HSN_MISSING_LABEL,
  readGstRatePercentFromProductAttributes,
  resolveDisplayProductHsn,
  resolveInvoiceHsnCode,
  resolveLineItemGstRatePercent,
  resolveVariantTaxFieldsFromProductAttributes
} from './product-tax-fields';

describe('product-tax-fields', () => {
  it('reads gst rate from product attributes with 5% default', () => {
    // Default fallback is 5% — the modal GST 2.0 slab for packaged food (12% was
    // abolished on 22 Sept 2025 and must never be the default again).
    expect(readGstRatePercentFromProductAttributes(null)).toBe(5);
    expect(readGstRatePercentFromProductAttributes({ gstRate: 5 })).toBe(5);
  });

  it('syncs variant tax fields from product attributes', () => {
    expect(
      resolveVariantTaxFieldsFromProductAttributes({
        hsnCode: '0910',
        gstRate: 5
      })
    ).toEqual({
      hsnCode: '0910',
      gstRatePercent: 5
    });
  });

  it('lets the EXPLICIT product rate win over the variant stamp (2026-08-10 regression)', () => {
    // The stamp is a denormalised copy that can go stale; the admin-entered
    // attributes.gstRate is the source of truth the product editor shows.
    // A ₹650 line was invoiced at 12% (stale stamp) while the editor said 5%.
    expect(resolveLineItemGstRatePercent(12, { gstRate: 5 })).toBe(5);
    expect(resolveLineItemGstRatePercent(18, { gstRate: 5 })).toBe(5);
    // Explicit 0 = NIL-rated good — honoured over any stamp.
    expect(resolveLineItemGstRatePercent(18, { gstRate: 0 })).toBe(0);
    // Explicit dead-slab entry is still the admin's call (surfaces via attributes).
    expect(resolveLineItemGstRatePercent(5, { gstRate: 12 })).toBe(12);
  });

  it('falls back to the variant stamp only for live GST 2.0 slabs', () => {
    // No explicit attribute rate: a live-slab stamp is trusted…
    expect(resolveLineItemGstRatePercent(18, {})).toBe(18);
    expect(resolveLineItemGstRatePercent(5, null)).toBe(5);
    // …but a dead-slab stamp (12/28) can only be the pre-GST-2.0 legacy default —
    // never bill it; use the platform default instead.
    expect(resolveLineItemGstRatePercent(12, {})).toBe(5);
    expect(resolveLineItemGstRatePercent(28, null)).toBe(5);
    // Nothing anywhere → platform default.
    expect(resolveLineItemGstRatePercent(0, {})).toBe(5);
    expect(resolveLineItemGstRatePercent(null, null)).toBe(5);
  });

  it('keeps hsn precedence on the variant for invoice line items', () => {
    expect(
      resolveInvoiceHsnCode({
        variantHsnCode: '1001',
        productAttributes: { hsnCode: '2002' }
      })
    ).toBe('1001');
    expect(
      resolveInvoiceHsnCode({
        variantHsnCode: null,
        productAttributes: {}
      })
    ).toBe(INVOICE_HSN_MISSING_LABEL);
  });

  it('resolveDisplayProductHsn returns explicit code or empty string', () => {
    expect(
      resolveDisplayProductHsn({
        variantHsnCode: '3304',
        productAttributes: {}
      })
    ).toBe('3304');
    expect(resolveDisplayProductHsn({ productAttributes: { hsnCode: 'NA' } })).toBe('');
  });
});
