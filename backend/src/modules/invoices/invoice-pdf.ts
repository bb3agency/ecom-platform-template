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
  logo: { width: 44, height: 44, objectFit: 'contain', marginBottom: 6 },
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

  colName: { width: '28%' },
  colHsn: { width: '10%' },
  colQty: { width: '6%', textAlign: 'right' },
  colRate: { width: '13%', textAlign: 'right' },
  colTotal: { width: '14%', textAlign: 'right' },
  colCgst: { width: '9.5%', textAlign: 'right' },
  colSgst: { width: '9.5%', textAlign: 'right' },
  colIgst: { width: '10%', textAlign: 'right' },

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

export async function renderInvoicePdfBuffer(payload: InvoicePdfPayload): Promise<Buffer> {
  const storeName = (payload.storeDisplayName ?? '').trim() || payload.seller.legalName;
  const showIgst = payload.igstPaise > 0 || payload.lineItems.some((item) => item.igstPaise > 0);

  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', style: styles.page },

      // Header: brand identity left, invoice meta right.
      createElement(
        View,
        { style: styles.headerRow },
        createElement(
          View,
          { style: { width: '55%' } },
          ...(payload.logo
            ? [createElement(Image, { style: styles.logo, src: { data: payload.logo.data, format: payload.logo.format } })]
            : []),
          createElement(Text, { style: styles.storeName }, storeName),
          createElement(Text, { style: styles.sellerMeta }, payload.seller.legalName),
          createElement(Text, { style: styles.sellerMeta }, payload.seller.addressLine),
          createElement(Text, { style: styles.sellerMeta }, `State: ${payload.seller.state}`),
          // FSSAI is optional — omit the segment entirely when not configured.
          createElement(
            Text,
            { style: styles.sellerMeta },
            payload.seller.fssai.trim()
              ? `GSTIN: ${payload.seller.gstin}   FSSAI: ${payload.seller.fssai}`
              : `GSTIN: ${payload.seller.gstin}`
          )
        ),
        createElement(
          View,
          { style: { width: '40%' } },
          createElement(Text, { style: styles.docTitle }, 'TAX INVOICE'),
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

      // Items table.
      createElement(
        View,
        { style: styles.tableHeader },
        createElement(Text, { style: [styles.th, styles.colName] }, 'Item'),
        createElement(Text, { style: [styles.th, styles.colHsn] }, 'HSN'),
        createElement(Text, { style: [styles.th, styles.colQty] }, 'Qty'),
        createElement(Text, { style: [styles.th, styles.colRate] }, 'Unit Price'),
        createElement(Text, { style: [styles.th, styles.colTotal] }, 'Amount'),
        createElement(Text, { style: [styles.th, styles.colCgst] }, 'CGST'),
        createElement(Text, { style: [styles.th, styles.colSgst] }, 'SGST'),
        createElement(Text, { style: [styles.th, styles.colIgst] }, 'IGST')
      ),
      ...payload.lineItems.map((item, index) =>
        createElement(
          View,
          { style: styles.tableRow, key: `${item.name}-${index}` },
          createElement(Text, { style: [styles.td, styles.colName] }, item.name),
          createElement(Text, { style: [styles.tdMuted, styles.colHsn] }, item.hsnCode),
          createElement(Text, { style: [styles.td, styles.colQty] }, String(item.quantity)),
          createElement(Text, { style: [styles.td, styles.colRate] }, formatPaise(item.unitPricePaise)),
          createElement(Text, { style: [styles.td, styles.colTotal] }, formatPaise(item.lineTotalPaise)),
          createElement(Text, { style: [styles.tdMuted, styles.colCgst] }, formatPaise(item.cgstPaise)),
          createElement(Text, { style: [styles.tdMuted, styles.colSgst] }, formatPaise(item.sgstPaise)),
          createElement(Text, { style: [styles.tdMuted, styles.colIgst] }, formatPaise(item.igstPaise))
        )
      ),

      // Totals.
      createElement(
        View,
        { style: styles.totalsWrap },
        createElement(
          View,
          { style: styles.totalsBox },
          totalsRow('Subtotal', formatPaise(payload.subtotalPaise)),
          totalsRow('Delivery / Shipping', formatPaise(payload.shippingPaise)),
          ...(payload.discountPaise > 0 ? [totalsRow('Discount', `- ${formatPaise(payload.discountPaise)}`)] : []),
          ...(!showIgst
            ? [totalsRow('CGST', formatPaise(payload.cgstPaise)), totalsRow('SGST', formatPaise(payload.sgstPaise))]
            : [totalsRow('IGST', formatPaise(payload.igstPaise))]),
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
          `${storeName} — GSTIN ${payload.seller.gstin}`
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
  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      createElement(
        View,
        { style: styles.headerRow },
        createElement(
          View,
          { style: { width: '55%' } },
          createElement(Text, { style: styles.storeName }, payload.seller.legalName),
          createElement(
            Text,
            { style: styles.sellerMeta },
            payload.seller.fssai.trim()
              ? `GSTIN: ${payload.seller.gstin}   FSSAI: ${payload.seller.fssai}`
              : `GSTIN: ${payload.seller.gstin}`
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
