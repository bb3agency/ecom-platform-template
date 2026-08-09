import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeInclusiveGstSplit, deriveInvoiceNumber, fetchInvoiceLogo } from './generate-invoice';

// 1x1 transparent PNG — valid magic bytes for the sniffer.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('fetchInvoiceLogo — URL resolution and format sniffing', () => {
  const originalStorefrontUrl = process.env.STOREFRONT_URL;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalStorefrontUrl === undefined) {
      delete process.env.STOREFRONT_URL;
    } else {
      process.env.STOREFRONT_URL = originalStorefrontUrl;
    }
  });

  function okResponse(bytes: Buffer) {
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  }

  it('resolves a site-relative path against STOREFRONT_URL', async () => {
    process.env.STOREFRONT_URL = 'https://www.example-store.com/';
    fetchMock.mockResolvedValue(okResponse(TINY_PNG));

    const logo = await fetchInvoiceLogo('/images/logo.png');

    expect(fetchMock).toHaveBeenCalledWith('https://www.example-store.com/images/logo.png', expect.anything());
    expect(logo).toMatchObject({ format: 'png' });
  });

  it('returns null for a relative path when STOREFRONT_URL is not configured', async () => {
    delete process.env.STOREFRONT_URL;

    expect(await fetchInvoiceLogo('/images/logo.png')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects protocol-relative URLs (no scheme smuggling)', async () => {
    process.env.STOREFRONT_URL = 'https://www.example-store.com';

    expect(await fetchInvoiceLogo('//evil.example/logo.png')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches absolute URLs directly and rejects non-image bytes', async () => {
    fetchMock.mockResolvedValue(okResponse(Buffer.from('<html>not an image</html>')));

    expect(await fetchInvoiceLogo('https://cdn.example.com/logo.png')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/logo.png', expect.anything());
  });
});

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
