import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
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

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 10,
    fontFamily: 'Helvetica'
  },
  heading: {
    fontSize: 14,
    marginBottom: 8
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4
  },
  section: {
    marginBottom: 10
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 4,
    marginBottom: 4
  },
  tableRow: {
    flexDirection: 'row',
    marginBottom: 3
  },
  colName: { width: '26%' },
  colHsn: { width: '12%' },
  colQty: { width: '8%' },
  colRate: { width: '13%' },
  colTax: { width: '13%' },
  colCgst: { width: '9%' },
  colSgst: { width: '9%' },
  colIgst: { width: '10%' }
});

function formatPaise(paise: number): string {
  return `INR ${(paise / 100).toFixed(2)}`;
}

export async function renderInvoicePdfBuffer(payload: InvoicePdfPayload): Promise<Buffer> {
  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      createElement(Text, { style: styles.heading }, 'Tax Invoice'),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Invoice No: ${payload.invoiceNumber}`),
        createElement(Text, null, `Order No: ${payload.orderNumber}`),
        createElement(Text, null, `Issued At: ${payload.issuedAtIso}`)
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Seller: ${payload.seller.legalName}`),
        createElement(Text, null, `Address: ${payload.seller.addressLine}`),
        createElement(Text, null, `State: ${payload.seller.state}`),
        createElement(Text, null, `GSTIN: ${payload.seller.gstin}`),
        createElement(Text, null, `FSSAI: ${payload.seller.fssai}`)
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Buyer: ${payload.buyer.fullName}`),
        createElement(Text, null, `Address: ${payload.buyer.addressLine}`),
        createElement(Text, null, `State: ${payload.buyer.state}`),
        createElement(Text, null, `Pincode: ${payload.buyer.pincode}`)
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(
          View,
          { style: styles.tableHeader },
          createElement(Text, { style: styles.colName }, 'Item'),
          createElement(Text, { style: styles.colHsn }, 'HSN'),
          createElement(Text, { style: styles.colQty }, 'Qty'),
          createElement(Text, { style: styles.colRate }, 'Unit'),
          createElement(Text, { style: styles.colTax }, 'Line Total'),
          createElement(Text, { style: styles.colCgst }, 'CGST'),
          createElement(Text, { style: styles.colSgst }, 'SGST'),
          createElement(Text, { style: styles.colIgst }, 'IGST')
        ),
        ...payload.lineItems.map((item, index) =>
          createElement(
            View,
            { style: styles.tableRow, key: `${item.name}-${index}` },
            createElement(Text, { style: styles.colName }, item.name),
            createElement(Text, { style: styles.colHsn }, item.hsnCode),
            createElement(Text, { style: styles.colQty }, String(item.quantity)),
            createElement(Text, { style: styles.colRate }, formatPaise(item.unitPricePaise)),
            createElement(Text, { style: styles.colTax }, formatPaise(item.lineTotalPaise)),
            createElement(Text, { style: styles.colCgst }, formatPaise(item.cgstPaise)),
            createElement(Text, { style: styles.colSgst }, formatPaise(item.sgstPaise)),
            createElement(Text, { style: styles.colIgst }, formatPaise(item.igstPaise))
          )
        )
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(View, { style: styles.row }, createElement(Text, null, 'Subtotal'), createElement(Text, null, formatPaise(payload.subtotalPaise))),
        createElement(View, { style: styles.row }, createElement(Text, null, 'Shipping'), createElement(Text, null, formatPaise(payload.shippingPaise))),
        createElement(View, { style: styles.row }, createElement(Text, null, 'Discount'), createElement(Text, null, formatPaise(payload.discountPaise))),
        createElement(View, { style: styles.row }, createElement(Text, null, 'CGST'), createElement(Text, null, formatPaise(payload.cgstPaise))),
        createElement(View, { style: styles.row }, createElement(Text, null, 'SGST'), createElement(Text, null, formatPaise(payload.sgstPaise))),
        createElement(View, { style: styles.row }, createElement(Text, null, 'IGST'), createElement(Text, null, formatPaise(payload.igstPaise))),
        createElement(View, { style: styles.row }, createElement(Text, null, 'Grand Total'), createElement(Text, null, formatPaise(payload.totalPaise)))
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Amount in Words: ${payload.amountInWords}`)
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
      createElement(Text, { style: styles.heading }, 'Credit Note'),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Credit Note No: ${payload.creditNoteNumber}`),
        createElement(Text, null, `Original Invoice No: ${payload.originalInvoiceNumber}`),
        createElement(Text, null, `Order No: ${payload.orderNumber}`),
        createElement(Text, null, `Issued At: ${payload.issuedAtIso}`)
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Seller: ${payload.seller.legalName}`),
        createElement(Text, null, `GSTIN: ${payload.seller.gstin}`),
        createElement(Text, null, `FSSAI: ${payload.seller.fssai}`)
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `Buyer: ${payload.buyer.fullName}`),
        createElement(Text, null, `Reason: ${payload.reason}`)
      ),
      createElement(
        View,
        { style: styles.section },
        createElement(View, { style: styles.row }, createElement(Text, null, 'Refund Amount'), createElement(Text, null, formatPaise(payload.refundAmountPaise)))
      )
    )
  );

  const arrayBuffer = await renderToBuffer(doc);
  return Buffer.from(arrayBuffer);
}

