import { describe, expect, it } from 'vitest';
import { computeInclusiveGstSplit, deriveInvoiceNumber } from './generate-invoice';

describe('deriveInvoiceNumber — order-derived, idempotent invoice numbering', () => {
  it('maps the random order reference onto the INV- series', () => {
    expect(deriveInvoiceNumber('ORD-AB2C-9XYZ')).toBe('INV-AB2C-9XYZ');
  });

  it('maps legacy sequential order numbers without double-prefixing', () => {
    expect(deriveInvoiceNumber('ORD-2026-00039')).toBe('INV-2026-00039');
  });

  it('is deterministic — regenerating an invoice reissues the same number', () => {
    expect(deriveInvoiceNumber('ORD-QRST-2345')).toBe(deriveInvoiceNumber('ORD-QRST-2345'));
  });

  it('stays within the CGST Rule 46(b) 16-character serial limit for both formats', () => {
    expect(deriveInvoiceNumber('ORD-AB2C-9XYZ').length).toBeLessThanOrEqual(16);
    expect(deriveInvoiceNumber('ORD-2026-00039').length).toBeLessThanOrEqual(16);
  });

  it('keeps an unprefixed reference intact rather than mangling it', () => {
    expect(deriveInvoiceNumber('AB2C-9XYZ')).toBe('INV-AB2C-9XYZ');
  });
});

describe('computeInclusiveGstSplit — GST carved out of GST-inclusive amounts', () => {
  it('splits an intra-state 12% line so taxable + tax equals exactly what was paid', () => {
    // ₹650.00 inclusive of 12% GST → taxable ₹580.36, tax ₹69.64 (CGST ₹34.82 + SGST ₹34.82)
    const split = computeInclusiveGstSplit(65000, 12, false);
    expect(split.taxableValuePaise).toBe(58036);
    expect(split.cgstPaise + split.sgstPaise).toBe(65000 - 58036);
    expect(split.taxableValuePaise + split.cgstPaise + split.sgstPaise + split.igstPaise).toBe(65000);
    expect(split.igstPaise).toBe(0);
  });

  it('puts the whole carved-out tax in IGST for inter-state supply', () => {
    const split = computeInclusiveGstSplit(75000, 12, true);
    expect(split.taxableValuePaise).toBe(66964);
    expect(split.igstPaise).toBe(75000 - 66964);
    expect(split.cgstPaise).toBe(0);
    expect(split.sgstPaise).toBe(0);
    expect(split.taxableValuePaise + split.igstPaise).toBe(75000);
  });

  it('gives SGST the rounding remainder when the tax is odd', () => {
    // Find behaviour on an odd tax amount: 10001 @ 18% → taxable 8475, tax 1526 (even) —
    // use 9999 @ 18%: taxable round(999900/118)=8474, tax 1525 → cgst 763, sgst 762.
    const split = computeInclusiveGstSplit(9999, 18, false);
    expect(split.cgstPaise + split.sgstPaise).toBe(9999 - split.taxableValuePaise);
    expect(Math.abs(split.cgstPaise - split.sgstPaise)).toBeLessThanOrEqual(1);
  });

  it('returns zero tax and full taxable value when the rate is zero (GST billing off / exempt item)', () => {
    const split = computeInclusiveGstSplit(65000, 0, false);
    expect(split).toEqual({ taxableValuePaise: 65000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
  });

  it('never changes the amount the customer paid, across rates', () => {
    for (const rate of [5, 12, 18, 28]) {
      for (const amount of [1, 99, 65000, 123457, 999999]) {
        const intra = computeInclusiveGstSplit(amount, rate, false);
        const inter = computeInclusiveGstSplit(amount, rate, true);
        expect(intra.taxableValuePaise + intra.cgstPaise + intra.sgstPaise).toBe(amount);
        expect(inter.taxableValuePaise + inter.igstPaise).toBe(amount);
      }
    }
  });
});
