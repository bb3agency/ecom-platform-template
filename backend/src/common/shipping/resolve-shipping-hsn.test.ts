import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIPPING_HSN_FALLBACK,
  normalizeShippingHsn,
  resolveDefaultShippingHsn,
  resolveExplicitShippingHsn,
  resolveShippingHsnCode
} from './resolve-shipping-hsn';

describe('resolve-shipping-hsn', () => {
  it('accepts numeric HSN codes up to 15 digits', () => {
    expect(normalizeShippingHsn('2106')).toBe('2106');
    expect(normalizeShippingHsn(' 0910 ')).toBe('0910');
  });

  it('rejects non-numeric and placeholder values', () => {
    expect(normalizeShippingHsn('NA')).toBeNull();
    expect(normalizeShippingHsn('N/A')).toBeNull();
    expect(normalizeShippingHsn('')).toBeNull();
    expect(normalizeShippingHsn('1234,5678')).toBeNull();
  });

  it('prefers variant HSN over product attributes', () => {
    expect(
      resolveExplicitShippingHsn({
        variantHsnCode: '1001',
        productAttributes: { hsnCode: '2002' }
      })
    ).toBe('1001');
  });

  it('falls back to default shipping HSN when product data is missing', () => {
    expect(resolveShippingHsnCode({})).toBe(DEFAULT_SHIPPING_HSN_FALLBACK);
    expect(
      resolveShippingHsnCode({
        productAttributes: { hsnCode: 'invalid' },
        defaultHsn: '3304'
      })
    ).toBe('3304');
  });

  it('reads DEFAULT_SHIPPING_HSN from env when valid', () => {
    expect(resolveDefaultShippingHsn({ DEFAULT_SHIPPING_HSN: '0409' })).toBe('0409');
    expect(resolveDefaultShippingHsn({ DEFAULT_SHIPPING_HSN: 'bad' })).toBe(DEFAULT_SHIPPING_HSN_FALLBACK);
  });
});
