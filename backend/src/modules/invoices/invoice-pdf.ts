import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';

export type InvoiceLineItem = {
  name: string;
  hsnCode: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  taxRatePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

export type InvoicePdfPayload = {
  invoiceNumber: string;
  orderNumber: string;
  issuedAtIso: string;
  seller: {
    legalName: string;
    addressLine: string;
    state: string;
    gstin: string;
    fssai: string;
  };
  buyer: {
    fullName: string;
    addressLine: string;
    state: string;
    pincode: string;
  };
  lineItems: InvoiceLineItem[];
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  totalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  amountInWords: string;
  /** Customer-facing store/brand name shown in the header (falls back to seller legal name). */
  storeDisplayName?: string;
  /** Pre-fetched store logo bytes (PNG/JPG only). Optional — header renders text-only without it. */
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null;
  /**
   * GST billing mode. true → "TAX INVOICE": per-row GST rate, ex-GST unit price,
   * taxable value, and the tax columns for the supply type; totals stack as
   * Taxable + CGST/SGST (or IGST) + untaxed Delivery = Grand Total (which always
   * equals the order total the customer actually paid — tax is carved out of the
   * GST-inclusive prices, never added on top). false → plain "INVOICE": no tax
   * columns. Defaults to true for backward compatibility with callers predating
   * the toggle.
   */
  gstBilling?: boolean;
  /**
   * Supply classification: true → IGST column, false → CGST+SGST columns.
   * When omitted, inferred from whether any IGST amount is present (legacy callers).
   */
  isInterState?: boolean;
};

export type CreditNotePdfPayload = {
  creditNoteNumber: string;
  originalInvoiceNumber: string;
  orderNumber: string;
  issuedAtIso: string;
  reason: string;
  refundAmountPaise: number;
  seller: {
    legalName: string;
    gstin: string;
    fssai: string;
  };
  buyer: {
    fullName: string;
  };
  /** Customer-facing store/brand name shown in the header (falls back to seller legal name). */
  storeDisplayName?: string;
  /** Pre-fetched store logo bytes (PNG/JPG only). Optional — header renders text-only without it. */
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null;
};

// Neutral, print-friendly palette (invoice must read cleanly in B/W print too).
const INK = '#111827';
const MUTED = '#6B7280';
const FAINT = '#9CA3AF';
const HAIRLINE = '#E5E7EB';
const HEADBG = '#F3F4F6';

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: INK
  },

  // ── Header ──────────────────────────────────────────────────────────────
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  // Brand block: logo pinned at the FAR LEFT, identity text stacked beside it.
  brandRow: { flexDirection: 'row', alignItems: 'flex-start' },
  logo: { width: 54, height: 54, objectFit: 'contain', marginRight: 12 },
  brandText: { flexGrow: 1, flexShrink: 1 },
  storeName: { fontSize: 17, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sellerMeta: { fontSize: 8.5, color: MUTED, lineHeight: 1.5 },
  docTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', letterSpacing: 2, color: MUTED, textAlign: 'right', marginBottom: 6 },
  metaLine: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
  metaLabel: { fontSize: 8.5, color: MUTED, marginRight: 6 },
  metaValue: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  headerRule: { borderBottomWidth: 1.5, borderBottomColor: INK, marginTop: 14, marginBottom: 16 },

  // ── Parties ─────────────────────────────────────────────────────────────
  partiesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  partyCol: { width: '48%' },
  partyLabel: { fontSize: 7.5, color: FAINT, letterSpacing: 1.2, marginBottom: 4, textTransform: 'uppercase' },
  partyName: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  partyDetail: { fontSize: 9, color: MUTED, lineHeight: 1.5 },

  // ── Items table ─────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: HEADBG,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginBottom: 2
  },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: HAIRLINE
  },
  td: { fontSize: 9 },
  tdMuted: { fontSize: 8.5, color: MUTED },
  right: { textAlign: 'right' },

  // Plain (non-GST) layout.
  colName: { width: '40%' },
  colHsn: { width: '14%' },
  colQty: { width: '8%', textAlign: 'right' },
  colRate: { width: '19%', textAlign: 'right' },
  colTotal: { width: '19%', textAlign: 'right' },
  // GST layout, intra-state (CGST + SGST columns).
  giName: { width: '20%' },
  giHsn: { width: '10%' },
  giRate: { width: '7%', textAlign: 'right' },
  giQty: { width: '5%', textAlign: 'right' },
  giUnit: { width: '12%', textAlign: 'right' },
  giTaxable: { width: '13%', textAlign: 'right' },
  giCgst: { width: '10.5%', textAlign: 'right' },
  giSgst: { width: '10.5%', textAlign: 'right' },
  giTotal: { width: '12%', textAlign: 'right' },
  // GST layout, inter-state (single IGST column).
  geName: { width: '23%' },
  geHsn: { width: '11%' },
  geRate: { width: '7%', textAlign: 'right' },
  geQty: { width: '5%', textAlign: 'right' },
  geUnit: { width: '13%', textAlign: 'right' },
  geTaxable: { width: '14%', textAlign: 'right' },
  geIgst: { width: '13%', textAlign: 'right' },
  geTotal: { width: '14%', textAlign: 'right' },

  // ── Totals ──────────────────────────────────────────────────────────────
  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalsBox: { width: '42%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { fontSize: 9, color: MUTED },
  totalsValue: { fontSize: 9 },
  grandRule: { borderTopWidth: 1.25, borderTopColor: INK, marginTop: 4, paddingTop: 6 },
  grandLabel: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },
  grandValue: { fontSize: 11.5, fontFamily: 'Helvetica-Bold' },

  amountWords: { marginTop: 14, fontSize: 8.5, color: MUTED, fontFamily: 'Helvetica-Oblique' },

  // ── Footer ──────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 26,
    left: 44,
    right: 44,
    borderTopWidth: 0.75,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
    textAlign: 'center'
  },
  footerText: { fontSize: 7.5, color: FAINT, lineHeight: 1.6 }
});

function formatPaise(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatIssuedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function metaLine(label: string, value: string) {
  return createElement(
    View,
    { style: styles.metaLine },
    createElement(Text, { style: styles.metaLabel }, label),
    createElement(Text, { style: styles.metaValue }, value)
  );
}

function totalsRow(label: string, value: string, muted = true) {
  return createElement(
    View,
    { style: styles.totalsRow },
    createElement(Text, { style: muted ? styles.totalsLabel : styles.grandLabel }, label),
    createElement(Text, { style: muted ? styles.totalsValue : styles.grandValue }, value)
  );
}

/**
 * "GSTIN: x   FSSAI: y" with each segment omitted when not configured — both
 * registrations are OPTIONAL for invoice generation. Returns null when neither
 * is set so the caller can drop the line entirely (no placeholders on the PDF).
 * Exported for tests.
 */
export function formatRegistrationLine(seller: { gstin: string; fssai: string }): string | null {
  const parts = [
    seller.gstin.trim() ? `GSTIN: ${seller.gstin.trim()}` : null,
    seller.fssai.trim() ? `FSSAI: ${seller.fssai.trim()}` : null
  ].filter((value): value is string => value !== null);
  return parts.length > 0 ? parts.join('   ') : null;
}

export async function renderInvoicePdfBuffer(payload: InvoicePdfPayload): Promise<Buffer> {
  const storeName = (payload.storeDisplayName ?? '').trim() || payload.seller.legalName;
  const showIgst =
    payload.isInterState ??
    (payload.igstPaise > 0 || payload.lineItems.some((item) => item.igstPaise > 0));
  const gstBilling = payload.gstBilling !== false;

  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', style: styles.page },

      // Header: brand identity left (logo at the far left, text beside it), invoice meta right.
      createElement(
        View,
        { style: styles.headerRow },
        createElement(
          View,
          { style: [styles.brandRow, { width: '55%' }] },
          ...(payload.logo
            ? [createElement(Image, { style: styles.logo, src: { data: payload.logo.data, format: payload.logo.format } })]
            : []),
          createElement(
            View,
            { style: styles.brandText },
            createElement(Text, { style: styles.storeName }, storeName),
            createElement(Text, { style: styles.sellerMeta }, payload.seller.legalName),
            createElement(Text, { style: styles.sellerMeta }, payload.seller.addressLine),
            createElement(Text, { style: styles.sellerMeta }, `State: ${payload.seller.state}`),
            // GSTIN and FSSAI are both optional — omit each segment (and the whole line)
            // when not configured instead of printing placeholders.
            ...(formatRegistrationLine(payload.seller)
              ? [createElement(Text, { style: styles.sellerMeta }, formatRegistrationLine(payload.seller))]
              : [])
          )
        ),
        createElement(
          View,
          { style: { width: '40%' } },
          createElement(Text, { style: styles.docTitle }, gstBilling ? 'TAX INVOICE' : 'INVOICE'),
          metaLine('Invoice No.', payload.invoiceNumber),
          metaLine('Order No.', payload.orderNumber),
          metaLine('Date', formatIssuedDate(payload.issuedAtIso))
        )
      ),
      createElement(View, { style: styles.headerRule }),

      // Billed to.
      createElement(
        View,
        { style: styles.partiesRow },
        createElement(
          View,
          { style: styles.partyCol },
          createElement(Text, { style: styles.partyLabel }, 'Billed & Shipped To'),
          createElement(Text, { style: styles.partyName }, payload.buyer.fullName),
          createElement(Text, { style: styles.partyDetail }, payload.buyer.addressLine),
          createElement(Text, { style: styles.partyDetail }, `${payload.buyer.state} — ${payload.buyer.pincode}`)
        ),
        createElement(
          View,
          { style: styles.partyCol },
          createElement(Text, { style: styles.partyLabel }, 'Place of Supply'),
          createElement(Text, { style: styles.partyDetail }, payload.buyer.state)
        )
      ),

      // Items table (goods only — delivery/shipping is billed untaxed in the totals
      // section, never as an item row). In GST-billing mode the sample-invoice layout
      // applies: per-row GST rate, ex-GST unit price, taxable value, then the tax
      // columns relevant to the supply (CGST+SGST intra-state, IGST inter-state), and
      // the row total = taxable + tax = what the customer actually paid for that line.
      gstBilling
        ? createElement(
            View,
            { style: styles.tableHeader },
            createElement(Text, { style: [styles.th, showIgst ? styles.geName : styles.giName] }, 'Item'),
            createElement(Text, { style: [styles.th, showIgst ? styles.geHsn : styles.giHsn] }, 'HSN'),
            createElement(Text, { style: [styles.th, showIgst ? styles.geRate : styles.giRate] }, 'GST %'),
            createElement(Text, { style: [styles.th, showIgst ? styles.geQty : styles.giQty] }, 'Qty'),
            createElement(Text, { style: [styles.th, showIgst ? styles.geUnit : styles.giUnit] }, 'Unit Price'),
            createElement(Text, { style: [styles.th, showIgst ? styles.geTaxable : styles.giTaxable] }, 'Taxable'),
            ...(showIgst
              ? [createElement(Text, { style: [styles.th, styles.geIgst] }, 'IGST')]
              : [
                  createElement(Text, { style: [styles.th, styles.giCgst] }, 'CGST'),
                  createElement(Text, { style: [styles.th, styles.giSgst] }, 'SGST')
                ]),
            createElement(Text, { style: [styles.th, showIgst ? styles.geTotal : styles.giTotal] }, 'Total')
          )
        : createElement(
            View,
            { style: styles.tableHeader },
            createElement(Text, { style: [styles.th, styles.colName] }, 'Item'),
            createElement(Text, { style: [styles.th, styles.colHsn] }, 'HSN'),
            createElement(Text, { style: [styles.th, styles.colQty] }, 'Qty'),
            createElement(Text, { style: [styles.th, styles.colRate] }, 'Unit Price'),
            createElement(Text, { style: [styles.th, styles.colTotal] }, 'Amount')
          ),
      ...payload.lineItems.map((item, index) => {
        if (!gstBilling) {
          return createElement(
            View,
            { style: styles.tableRow, key: `${item.name}-${index}` },
            createElement(Text, { style: [styles.td, styles.colName] }, item.name),
            createElement(Text, { style: [styles.tdMuted, styles.colHsn] }, item.hsnCode),
            createElement(Text, { style: [styles.td, styles.colQty] }, String(item.quantity)),
            createElement(Text, { style: [styles.td, styles.colRate] }, formatPaise(item.unitPricePaise)),
            createElement(Text, { style: [styles.td, styles.colTotal] }, formatPaise(item.lineTotalPaise))
          );
        }
        // Taxable value is authoritative (sums reconcile exactly); the ex-GST unit
        // price is taxable/qty rounded for display only.
        const taxablePaise = item.lineTotalPaise - item.cgstPaise - item.sgstPaise - item.igstPaise;
        const unitExGstPaise = item.quantity > 0 ? Math.round(taxablePaise / item.quantity) : taxablePaise;
        return createElement(
          View,
          { style: styles.tableRow, key: `${item.name}-${index}` },
          createElement(Text, { style: [styles.td, showIgst ? styles.geName : styles.giName] }, item.name),
          createElement(Text, { style: [styles.tdMuted, showIgst ? styles.geHsn : styles.giHsn] }, item.hsnCode),
          createElement(Text, { style: [styles.tdMuted, showIgst ? styles.geRate : styles.giRate] }, `${item.taxRatePercent}%`),
          createElement(Text, { style: [styles.td, showIgst ? styles.geQty : styles.giQty] }, String(item.quantity)),
          createElement(Text, { style: [styles.td, showIgst ? styles.geUnit : styles.giUnit] }, formatPaise(unitExGstPaise)),
          createElement(Text, { style: [styles.td, showIgst ? styles.geTaxable : styles.giTaxable] }, formatPaise(taxablePaise)),
          ...(showIgst
            ? [createElement(Text, { style: [styles.tdMuted, styles.geIgst] }, formatPaise(item.igstPaise))]
            : [
                createElement(Text, { style: [styles.tdMuted, styles.giCgst] }, formatPaise(item.cgstPaise)),
                createElement(Text, { style: [styles.tdMuted, styles.giSgst] }, formatPaise(item.sgstPaise))
              ]),
          createElement(Text, { style: [styles.td, showIgst ? styles.geTotal : styles.giTotal] }, formatPaise(item.lineTotalPaise))
        );
      }),

      // Totals. The grand total is ALWAYS what the customer actually paid. In GST-billing
      // mode the stack sums visibly: Taxable Value + CGST + SGST (or IGST) + untaxed
      // Delivery/Shipping = Grand Total. Item rows are already net of any discount.
      createElement(
        View,
        { style: styles.totalsWrap },
        createElement(
          View,
          { style: styles.totalsBox },
          ...(gstBilling
            ? [
                ...(payload.discountPaise > 0
                  ? [totalsRow('Discount (applied to items)', `- ${formatPaise(payload.discountPaise)}`)]
                  : []),
                totalsRow(
                  'Taxable Value',
                  formatPaise(
                    payload.lineItems.reduce(
                      (sum, item) => sum + item.lineTotalPaise - item.cgstPaise - item.sgstPaise - item.igstPaise,
                      0
                    )
                  )
                ),
                ...(!showIgst
                  ? [
                      totalsRow('CGST', formatPaise(payload.cgstPaise)),
                      totalsRow('SGST', formatPaise(payload.sgstPaise))
                    ]
                  : [totalsRow('IGST', formatPaise(payload.igstPaise))]),
                totalsRow('Delivery / Shipping (untaxed)', formatPaise(payload.shippingPaise))
              ]
            : [
                totalsRow('Subtotal', formatPaise(payload.subtotalPaise)),
                totalsRow('Delivery / Shipping', formatPaise(payload.shippingPaise)),
                ...(payload.discountPaise > 0
                  ? [totalsRow('Discount', `- ${formatPaise(payload.discountPaise)}`)]
                  : [])
              ]),
          createElement(
            View,
            { style: [styles.totalsRow, styles.grandRule] },
            createElement(Text, { style: styles.grandLabel }, 'Grand Total'),
            createElement(Text, { style: styles.grandValue }, formatPaise(payload.totalPaise))
          )
        )
      ),

      createElement(Text, { style: styles.amountWords }, `Amount in words: ${payload.amountInWords}`),

      // Footer.
      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(
          Text,
          { style: styles.footerText },
          payload.seller.gstin.trim()
            ? `${storeName} — GSTIN ${payload.seller.gstin}`
            : storeName
        ),
        createElement(
          Text,
          { style: styles.footerText },
          'This is a computer-generated tax invoice and does not require a signature.'
        )
      )
    )
  );

  const arrayBuffer = await renderToBuffer(doc);
  return Buffer.from(arrayBuffer);
}

export async function renderCreditNotePdfBuffer(payload: CreditNotePdfPayload): Promise<Buffer> {
  const creditStoreName = (payload.storeDisplayName ?? '').trim() || payload.seller.legalName;
  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      // Same brand block as the invoice: logo at the far left, identity text beside it.
      createElement(
        View,
        { style: styles.headerRow },
        createElement(
          View,
          { style: [styles.brandRow, { width: '55%' }] },
          ...(payload.logo
            ? [createElement(Image, { style: styles.logo, src: { data: payload.logo.data, format: payload.logo.format } })]
            : []),
          createElement(
            View,
            { style: styles.brandText },
            createElement(Text, { style: styles.storeName }, creditStoreName),
            createElement(Text, { style: styles.sellerMeta }, payload.seller.legalName),
            ...(formatRegistrationLine(payload.seller)
              ? [createElement(Text, { style: styles.sellerMeta }, formatRegistrationLine(payload.seller))]
              : [])
          )
        ),
        createElement(
          View,
          { style: { width: '40%' } },
          createElement(Text, { style: styles.docTitle }, 'CREDIT NOTE'),
          metaLine('Credit Note No.', payload.creditNoteNumber),
          metaLine('Invoice No.', payload.originalInvoiceNumber),
          metaLine('Order No.', payload.orderNumber),
          metaLine('Date', formatIssuedDate(payload.issuedAtIso))
        )
      ),
      createElement(View, { style: styles.headerRule }),
      createElement(
        View,
        { style: styles.partiesRow },
        createElement(
          View,
          { style: styles.partyCol },
          createElement(Text, { style: styles.partyLabel }, 'Issued To'),
          createElement(Text, { style: styles.partyName }, payload.buyer.fullName)
        ),
        createElement(
          View,
          { style: styles.partyCol },
          createElement(Text, { style: styles.partyLabel }, 'Reason'),
          createElement(Text, { style: styles.partyDetail }, payload.reason)
        )
      ),
      createElement(
        View,
        { style: styles.totalsWrap },
        createElement(
          View,
          { style: styles.totalsBox },
          createElement(
            View,
            { style: [styles.totalsRow, styles.grandRule] },
            createElement(Text, { style: styles.grandLabel }, 'Refund Amount'),
            createElement(Text, { style: styles.grandValue }, formatPaise(payload.refundAmountPaise))
          )
        )
      ),
      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(
          Text,
          { style: styles.footerText },
          'This is a computer-generated credit note and does not require a signature.'
        )
      )
    )
  );

  const arrayBuffer = await renderToBuffer(doc);
  return Buffer.from(arrayBuffer);
}
