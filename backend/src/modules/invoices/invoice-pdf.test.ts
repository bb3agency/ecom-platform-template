import { describe, expect, it } from 'vitest';
import {
  formatRegistrationLine,
  renderCreditNotePdfBuffer,
  renderInvoicePdfBuffer,
  type InvoicePdfPayload
} from './invoice-pdf';

describe('formatRegistrationLine', () => {
  it('joins both segments when GSTIN and FSSAI are set', () => {
    expect(formatRegistrationLine({ gstin: '36ABCDE1234F1Z5', fssai: '12345678901234' })).toBe(
      'GSTIN: 36ABCDE1234F1Z5   FSSAI: 12345678901234'
    );
  });

  it('renders GSTIN alone when FSSAI is absent', () => {
    expect(formatRegistrationLine({ gstin: '36ABCDE1234F1Z5', fssai: '' })).toBe(
      'GSTIN: 36ABCDE1234F1Z5'
    );
  });

  it('renders FSSAI alone when GSTIN is absent', () => {
    expect(formatRegistrationLine({ gstin: '', fssai: '12345678901234' })).toBe(
      'FSSAI: 12345678901234'
    );
  });

  it('returns null when neither registration is configured — the line is dropped entirely', () => {
    expect(formatRegistrationLine({ gstin: '', fssai: '' })).toBeNull();
    expect(formatRegistrationLine({ gstin: '   ', fssai: '  ' })).toBeNull();
  });
});

function invoicePayload(overrides: Partial<InvoicePdfPayload['seller']>): InvoicePdfPayload {
  return {
    storeDisplayName: 'Test Store',
    logo: null,
    invoiceNumber: 'INV-2026-00001',
    orderNumber: 'ORD-1001',
    issuedAtIso: '2026-08-08T00:00:00.000Z',
    seller: {
      legalName: 'Test Store Pvt Ltd',
      addressLine: '12 Market Road, Guntur',
      state: 'Andhra Pradesh',
      gstin: '',
      fssai: '',
      ...overrides
    },
    buyer: {
      fullName: 'A Customer',
      addressLine: '1 Beach Road, Vizag',
      state: 'Andhra Pradesh',
      pincode: '530001'
    },
    lineItems: [
      {
        name: 'Ghee 500ml',
        hsnCode: '0405',
        quantity: 2,
        unitPricePaise: 45000,
        lineTotalPaise: 90000,
        taxRatePercent: 12,
        cgstPaise: 5400,
        sgstPaise: 5400,
        igstPaise: 0
      }
    ],
    subtotalPaise: 90000,
    shippingPaise: 5000,
    discountPaise: 0,
    totalPaise: 95000,
    cgstPaise: 5400,
    sgstPaise: 5400,
    igstPaise: 0,
    amountInWords: 'Nine Hundred Fifty Rupees Only'
  };
}

describe('renderInvoicePdfBuffer GST billing modes', () => {
  it('renders a plain INVOICE (no tax columns) when gstBilling is false', async () => {
    const buffer = await renderInvoicePdfBuffer({ ...invoicePayload({}), gstBilling: false, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a TAX INVOICE with the includes-GST breakdown when gstBilling is true', async () => {
    const buffer = await renderInvoicePdfBuffer({ ...invoicePayload({ gstin: '36ABCDE1234F1Z5' }), gstBilling: true });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders weight-based lines (kg quantities) without breaking the table', async () => {
    // A 500 g pack ordered twice prints as "1 kg" with a per-kg rate; the wider
    // Quantity column has to survive that in both GST layouts.
    const payload = invoicePayload({ gstin: '36ABCDE1234F1Z5' });
    const withWeights = {
      ...payload,
      gstBilling: true,
      lineItems: payload.lineItems.map((item) => ({ ...item, weightGrams: 500 }))
    };
    expect((await renderInvoicePdfBuffer(withWeights)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await renderInvoicePdfBuffer({ ...withWeights, gstBilling: false })).subarray(0, 5).toString()
    ).toBe('%PDF-');
  });

  it('renders mixed weight and count lines in one invoice', async () => {
    // The reason the unit is per ROW: a catalogue holds both a 500 g pack and a
    // bottle sold by the piece, and a single "Quantity (kg)" header would be a
    // false statement about the bottle.
    const payload = invoicePayload({ gstin: '36ABCDE1234F1Z5' });
    const first = payload.lineItems[0];
    if (!first) throw new Error('fixture must have a line item');
    const buffer = await renderInvoicePdfBuffer({
      ...payload,
      gstBilling: true,
      lineItems: [
        { ...first, weightGrams: 500 },
        { ...first, name: 'Gift Box', weightGrams: null }
      ]
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders the inter-state layout (single IGST column) when isInterState is true', async () => {
    const payload = invoicePayload({ gstin: '36ABCDE1234F1Z5' });
    const buffer = await renderInvoicePdfBuffer({
      ...payload,
      gstBilling: true,
      isInterState: true,
      lineItems: payload.lineItems.map((item) => ({
        ...item,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 10800
      })),
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 10800
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('renderInvoicePdfBuffer with optional registrations', () => {
  it('renders a PDF when neither GSTIN nor FSSAI is configured', async () => {
    const buffer = await renderInvoicePdfBuffer(invoicePayload({}));
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a PDF with GSTIN only', async () => {
    const buffer = await renderInvoicePdfBuffer(invoicePayload({ gstin: '36ABCDE1234F1Z5' }));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a PDF with both registrations', async () => {
    const buffer = await renderInvoicePdfBuffer(
      invoicePayload({ gstin: '36ABCDE1234F1Z5', fssai: '12345678901234' })
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

// 1x1 transparent PNG — enough for react-pdf to embed as a real image.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('brand logo in the header', () => {
  it('renders the invoice with a logo at the left of the header', async () => {
    const buffer = await renderInvoicePdfBuffer({
      ...invoicePayload({ gstin: '36ABCDE1234F1Z5' }),
      logo: { data: TINY_PNG, format: 'png' }
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    // An embedded image object must exist in the PDF (text-only renders have none).
    expect(buffer.toString('latin1')).toContain('/Image');
  });

  it('renders the credit note with the same logo treatment', async () => {
    const buffer = await renderCreditNotePdfBuffer({
      creditNoteNumber: 'CN-2026-00042',
      originalInvoiceNumber: 'INV-2026-00042',
      orderNumber: 'ORD-AB2C-9XYZ',
      issuedAtIso: '2026-08-09T00:00:00.000Z',
      reason: 'Order cancelled',
      refundAmountPaise: 95000,
      seller: { legalName: 'Test Store Pvt Ltd', gstin: '', fssai: '' },
      buyer: { fullName: 'A Customer' },
      storeDisplayName: 'Test Store',
      logo: { data: TINY_PNG, format: 'png' }
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.toString('latin1')).toContain('/Image');
  });
});

describe('renderCreditNotePdfBuffer with optional registrations', () => {
  it('renders a credit note when neither GSTIN nor FSSAI is configured', async () => {
    const buffer = await renderCreditNotePdfBuffer({
      creditNoteNumber: 'CN-2026-00001',
      originalInvoiceNumber: 'INV-2026-00001',
      orderNumber: 'ORD-1001',
      issuedAtIso: '2026-08-08T00:00:00.000Z',
      reason: 'Order cancelled',
      refundAmountPaise: 95000,
      seller: { legalName: 'Test Store Pvt Ltd', gstin: '', fssai: '' },
      buyer: { fullName: 'A Customer' }
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
