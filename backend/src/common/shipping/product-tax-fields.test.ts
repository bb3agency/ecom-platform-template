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
  it('reads gst rate from product attributes with 12% default', () => {
    expect(readGstRatePercentFromProductAttributes(null)).toBe(12);
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

  it('prefers variant gst rate and hsn for invoice line items', () => {
    expect(
      resolveLineItemGstRatePercent(18, { gstRate: 5 })
    ).toBe(18);
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
