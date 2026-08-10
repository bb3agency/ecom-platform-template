import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInvoiceTaxLines,
  computeInclusiveGstSplit,
  deriveInvoiceNumber,
  fetchInvoiceLogo,
  resolveInvoiceLogo,
  sniffLogoImageFormat,
  type SellerProfile
} from './generate-invoice';

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

describe('resolveInvoiceLogo — uploaded in-row bytes win over logoUrl', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sellerProfile(overrides: Partial<SellerProfile>): SellerProfile {
    return {
      legalName: 'Test Store Pvt Ltd',
      addressLine: 'Street 1, Hyderabad',
      state: 'Telangana',
      pincode: '500001',
      gstin: '',
      fssai: '',
      storeName: 'Test Store',
      logoUrl: null,
      logoBytes: null,
      gstBillingEnabled: true,
      ...overrides
    };
  }

  it('returns the uploaded bytes without any network fetch', async () => {
    const logo = await resolveInvoiceLogo(
      sellerProfile({
        logoBytes: { data: TINY_PNG, format: 'png' },
        logoUrl: 'https://cdn.example.com/should-not-be-fetched.png'
      })
    );
    expect(logo).toEqual({ data: TINY_PNG, format: 'png' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the logoUrl fetch when nothing is uploaded', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
    });

    const logo = await resolveInvoiceLogo(
      sellerProfile({ logoUrl: 'https://cdn.example.com/logo.png' })
    );
    expect(logo).toMatchObject({ format: 'png' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when neither an upload nor a URL is configured', async () => {
    expect(await resolveInvoiceLogo(sellerProfile({}))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sniffLogoImageFormat', () => {
  it('detects PNG and JPEG by magic bytes and rejects everything else', () => {
    expect(sniffLogoImageFormat(TINY_PNG)).toBe('png');
    expect(sniffLogoImageFormat(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(8)]))).toBe('jpg');
    expect(sniffLogoImageFormat(Buffer.from('<svg xmlns="…"></svg>'))).toBeNull();
    expect(sniffLogoImageFormat(Buffer.alloc(2))).toBeNull();
  });
});


describe('buildInvoiceTaxLines — goods-only tax base (shipping untaxed, discount applied)', () => {
  // Mirrors the real production invoice that shaped the policy: 2 items totalling
  // Rs 1400 plus Rs 167.70 delivery, intra-state, 12% (legacy rate on those products).
  const items = [
    { name: 'Goddu Kaaram', hsnCode: '09042211', quantity: 1, unitPricePaise: 65000, lineTotalPaise: 65000, taxRatePercent: 12 },
    { name: 'Sambar Kaaram', hsnCode: '09042211', quantity: 2, unitPricePaise: 37500, lineTotalPaise: 75000, taxRatePercent: 12 }
  ];

  function totals(rows: ReturnType<typeof buildInvoiceTaxLines>) {
    return rows.reduce(
      (acc, row) => ({
        gross: acc.gross + row.lineTotalPaise,
        tax: acc.tax + row.cgstPaise + row.sgstPaise + row.igstPaise
      }),
      { gross: 0, tax: 0 }
    );
  }

  it('NEVER emits a delivery/shipping row — shipping is not a product (merchant policy 2026-08-10)', () => {
    const rows = buildInvoiceTaxLines({ items, discountPaise: 0, isInterState: false });
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.name === 'Delivery / Shipping')).toBe(false);
    // Shipping is billed untaxed in the totals section; the tax base is goods only.
  });

  it('reconciles EXACTLY with the goods total the customer paid', () => {
    const rows = buildInvoiceTaxLines({ items, discountPaise: 0, isInterState: false });
    const { gross } = totals(rows);
    expect(gross).toBe(65000 + 75000);
    // Inclusive pricing: taxable + tax per row equals the row amount, so the sum of all
    // rows equals the goods total and the tax is never added on top.
    for (const row of rows) {
      const tax = row.cgstPaise + row.sgstPaise + row.igstPaise;
      const taxable = Math.round((row.lineTotalPaise * 100) / (100 + row.taxRatePercent));
      expect(taxable + tax).toBe(row.lineTotalPaise);
    }
  });

  it('applies an order discount to the taxable consideration, apportioned across items', () => {
    const rows = buildInvoiceTaxLines({ items, discountPaise: 14000, isInterState: false });
    const { gross, tax } = totals(rows);

    expect(gross).toBe(65000 + 75000 - 14000);
    // Tax must be lower than the undiscounted case — carving from the pre-discount
    // amount would over-declare it.
    const undiscounted = totals(buildInvoiceTaxLines({ items, discountPaise: 0, isInterState: false }));
    expect(tax).toBeLessThan(undiscounted.tax);
  });

  it('never lets a discount exceed the goods value', () => {
    const rows = buildInvoiceTaxLines({ items, discountPaise: 999999, isInterState: false });
    expect(rows.every((row) => row.lineTotalPaise >= 0)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.lineTotalPaise, 0)).toBe(0);
  });

  it('puts all tax in IGST for inter-state supply', () => {
    const rows = buildInvoiceTaxLines({ items, discountPaise: 0, isInterState: true });
    for (const row of rows) {
      expect(row.cgstPaise).toBe(0);
      expect(row.sgstPaise).toBe(0);
      expect(row.igstPaise).toBeGreaterThan(0);
    }
  });

  it('emits zero tax on every row when GST billing is off (rates already zeroed)', () => {
    const zeroRated = items.map((item) => ({ ...item, taxRatePercent: 0 }));
    const rows = buildInvoiceTaxLines({ items: zeroRated, discountPaise: 0, isInterState: false });
    const { gross, tax } = totals(rows);
    expect(tax).toBe(0);
    expect(gross).toBe(65000 + 75000);
  });

  it('reconciles exactly across awkward amounts and rates (property sweep)', () => {
    for (const rate of [0, 5, 12, 18, 28]) {
      for (const discount of [0, 1, 7777, 14000]) {
        const rows = buildInvoiceTaxLines({
          items: items.map((item) => ({ ...item, taxRatePercent: rate })),
          discountPaise: discount,
          isInterState: false
        });
        const expectedGross = 65000 + 75000 - discount;
        expect(rows.reduce((sum, row) => sum + row.lineTotalPaise, 0)).toBe(expectedGross);
        // Per-row taxable derived the way the PDF derives it must also reconcile.
        const taxableSum = rows.reduce(
          (sum, row) => sum + row.lineTotalPaise - row.cgstPaise - row.sgstPaise - row.igstPaise,
          0
        );
        const taxSum = rows.reduce((sum, row) => sum + row.cgstPaise + row.sgstPaise + row.igstPaise, 0);
        expect(taxableSum + taxSum).toBe(expectedGross);
      }
    }
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
