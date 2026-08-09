import { type Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { type InvoiceStorageAdapter } from '@common/interfaces/invoice-storage.interface';
import { renderInvoicePdfBuffer, type InvoiceLineItem } from '@modules/invoices/invoice-renderer';
import { resolveGstInvoicingEnabled } from '@common/invoicing/gst-invoicing-flag';
import {
  resolveInvoiceHsnCode,
  resolveLineItemGstRatePercent
} from '@common/shipping/product-tax-fields';

/**
 * Shared GST invoice generation for an order.
 *
 * Lives in the invoices module (not the worker) so BOTH entry points share one
 * implementation:
 *  - the `generate-invoice` queue job (primary path — invoice is pre-generated
 *    seconds after the order is confirmed), and
 *  - on-demand generation inside the invoice download endpoints (fallback path —
 *    the customer or admin clicks "Download invoice" before the job has run, or
 *    after it dead-lettered).
 *
 * Generation is idempotent per order: the transaction re-checks for an existing
 * `Invoice` row, and `Invoice.orderId` is unique, so a concurrent duplicate run
 * fails the insert instead of double-issuing an invoice number for the order.
 * The invoice NUMBER is idempotent too — derived from the order number (see
 * deriveInvoiceNumber), so deleting an Invoice row and regenerating reissues the
 * exact same number instead of consuming a fresh serial.
 */

export type ShippingAddress = {
  fullName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

export type InvoiceOrderItem = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  variant: {
    hsnCode: string | null;
    gstRatePercent: number;
    product: {
      attributes: Prisma.JsonValue;
    } | null;
  } | null;
};

export type SellerProfile = {
  legalName: string;
  addressLine: string;
  state: string;
  gstin: string;
  fssai: string;
  /** Customer-facing store/brand name for the invoice header (may equal legalName). */
  storeName: string;
  /** Store logo URL (StoreSettings.logoUrl); rendered on the invoice when fetchable PNG/JPG. */
  logoUrl: string | null;
  /**
   * Uploaded logo stored in-row (StoreSettings.logoData, via the admin upload).
   * Takes precedence over logoUrl — read straight from the DB row, no HTTP fetch.
   */
  logoBytes: { data: Buffer; format: 'png' | 'jpg' } | null;
  /**
   * Effective GST billing mode: merchant toggle (StoreSettings.gstBillingEnabled) when
   * set, else auto — on when a GSTIN is configured. When true the invoice is a
   * "TAX INVOICE" with the GST portion carved out of the GST-INCLUSIVE prices; when
   * false it renders as a plain "INVOICE" with no tax columns. Never changes totals.
   */
  gstBillingEnabled: boolean;
};

/**
 * Statuses for which an invoice may exist or be generated. Pre-payment and
 * failed/cancelled states never get an invoice (cancellations of invoiced orders
 * are handled via credit notes, not by deleting invoices).
 */
export const INVOICE_ELIGIBLE_ORDER_STATUSES = [
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED'
] as const;

export function isInvoiceEligibleOrderStatus(status: string): boolean {
  return (INVOICE_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Logo size cap shared by the admin upload and the URL fetch path. */
export const STORE_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Magic-byte sniff for the two formats react-pdf can embed. Returns null for
 * anything else (SVG, WebP, HTML error pages…). Trust bytes, never the
 * caller-supplied mime type.
 */
export function sniffLogoImageFormat(bytes: Buffer): 'png' | 'jpg' | null {
  if (bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpg';
  }
  return null;
}

/**
 * Best-effort fetch of the store logo for the invoice header. Any failure (timeout,
 * non-image, unsupported format) returns null — the invoice renders text-only.
 * react-pdf embeds only PNG/JPG, so other formats are skipped by magic-byte sniff.
 *
 * Accepts an absolute http(s) URL or a SITE-RELATIVE path (`/images/logo.png`),
 * resolved against STOREFRONT_URL — so a merchant can point at an asset already
 * served by their own storefront without knowing the full domain.
 */
export async function fetchInvoiceLogo(
  logoUrl: string | null
): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  let url = (logoUrl ?? '').trim();
  if (url.startsWith('/') && !url.startsWith('//')) {
    const base = (process.env.STOREFRONT_URL ?? '').trim().replace(/\/+$/, '');
    if (!base) return null;
    url = `${base}${url}`;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > STORE_LOGO_MAX_BYTES) return null;
    const format = sniffLogoImageFormat(bytes);
    return format ? { data: bytes, format } : null;
  } catch {
    return null;
  }
}

/**
 * The logo to embed for this seller: the UPLOADED in-row logo wins (original
 * bytes — original ratio and quality, no re-encode, no network); a configured
 * logoUrl is the fallback. Null → text-only header.
 */
export async function resolveInvoiceLogo(
  sellerProfile: SellerProfile
): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  return sellerProfile.logoBytes ?? fetchInvoiceLogo(sellerProfile.logoUrl);
}

/** Stored logo bytes → embeddable logo, format re-verified by magic bytes. */
function resolveStoredLogoBytes(
  logoData: Uint8Array | Buffer | null
): { data: Buffer; format: 'png' | 'jpg' } | null {
  if (!logoData || logoData.length === 0) return null;
  const data = Buffer.isBuffer(logoData) ? logoData : Buffer.from(logoData);
  const format = sniffLogoImageFormat(data);
  return format ? { data, format } : null;
}

export async function resolveSellerProfileOrThrow(prisma: PrismaClient): Promise<SellerProfile> {
  const storeSettingsDelegate = (prisma as unknown as { storeSettings?: PrismaClient['storeSettings'] }).storeSettings;
  const settings = storeSettingsDelegate
    ? await storeSettingsDelegate.findUnique({
        where: { singletonKey: 'default' },
        select: {
          storeName: true,
          logoUrl: true,
          logoData: true,
          logoMimeType: true,
          sellerLegalName: true,
          sellerAddress: true,
          sellerState: true,
          gstin: true,
          fssaiNumber: true,
          gstBillingEnabled: true
        }
      })
    : null;

  const legalName = (settings?.sellerLegalName ?? settings?.storeName ?? '').trim();
  const addressLine = (settings?.sellerAddress ?? '').trim();
  const state = (settings?.sellerState ?? '').trim();
  const gstin = (settings?.gstin ?? '').trim();
  const fssai = (settings?.fssaiNumber ?? '').trim();
  const gstBillingSetting = (settings as { gstBillingEnabled?: boolean | null } | null)?.gstBillingEnabled;

  // GSTIN and FSSAI are OPTIONAL for invoice generation (2026-08-08) — neither ever
  // blocks a PDF. When absent, the renderer omits the corresponding line instead of
  // printing a placeholder, and STORE_REQUIRES_FSSAI no longer hard-fails generation.
  // Previously a missing GSTIN (production) or missing FSSAI (food clients) threw a
  // 500 that the error handler masked to "Something went wrong" — a merchant-config
  // gap read as an outage on the invoice download button.
  //
  // What still blocks (production only): a truly unconfigured seller identity —
  // no name, address, or state to print on a legal invoice header. That throws
  // VALIDATION_ERROR (422) with actionable copy so the admin UI can show exactly
  // what to fill in; the worker path still fails the job into retry/dead-letter.
  if (process.env.NODE_ENV === 'production') {
    const missing = [
      !legalName ? 'store/seller name' : null,
      !addressLine ? 'seller address' : null,
      !state ? 'seller state' : null
    ].filter((value): value is string => value !== null);

    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Invoice generation is not configured: missing ${missing.join(', ')}. Complete the store profile in Admin → Settings → Store.`,
        422
      );
    }
  }

  return {
    legalName: legalName || 'Ecom Store Pvt Ltd',
    addressLine: addressLine || 'Address not configured',
    state: state || 'Unknown',
    // GSTIN and FSSAI are OPTIONAL — empty means the PDF omits the corresponding
    // segment entirely (see formatRegistrationLine in invoice-pdf.ts); never
    // placeholder text on a legal document.
    gstin: gstin || '',
    fssai: fssai || '',
    storeName: (settings?.storeName ?? '').trim() || legalName || 'Ecom Store Pvt Ltd',
    logoUrl: ((settings as { logoUrl?: string | null } | null)?.logoUrl ?? '').trim() || null,
    logoBytes: resolveStoredLogoBytes(
      (settings as { logoData?: Uint8Array | Buffer | null } | null)?.logoData ?? null
    ),
    // Merchant toggle wins when set; auto default = GST billing on only when a GSTIN exists.
    gstBillingEnabled: gstBillingSetting ?? Boolean(gstin)
  };
}

/**
 * Invoice number derived from the order number: `ORD-AB2C-9XYZ` → `INV-AB2C-9XYZ`.
 *
 * Why derived, not sequential (2026-08-09): a global counter consumes a fresh number on
 * every (re)generation — deleting a bad Invoice row to re-render it burned a serial and
 * left a gap, and the counter itself leaked business volume. Deriving from the order
 * reference makes numbering IDEMPOTENT (regenerating an order's invoice always reissues
 * the same number), globally unique (order numbers are unique), and within CGST Rule
 * 46(b)'s 16-character limit (alphabets, numerals, and "-" are permitted; `INV-` + the
 * 9-char order ref = 13 chars; legacy `ORD-YYYY-#####` refs map to 14 chars).
 */
export function deriveInvoiceNumber(orderNumber: string): string {
  const ref = orderNumber.replace(/^ORD-/, '');
  return `INV-${ref}`;
}

/**
 * GST split for a GST-INCLUSIVE line amount (Indian B2C catalog prices include GST).
 * The tax is CARVED OUT of the amount, never added on top — so per-line
 * taxable + tax always equals the amount the customer paid for that line:
 *   taxable = round(amount × 100 / (100 + rate)); tax = amount − taxable.
 * Intra-state splits the tax into CGST + SGST (SGST takes the rounding remainder);
 * inter-state puts it all in IGST. rate <= 0 → whole amount taxable, zero tax.
 * Exported for tests.
 */
export function computeInclusiveGstSplit(
  lineTotalPaise: number,
  ratePercent: number,
  isInterState: boolean
): { taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number } {
  if (ratePercent <= 0) {
    return { taxableValuePaise: lineTotalPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  }
  const taxableValuePaise = Math.round((lineTotalPaise * 100) / (100 + ratePercent));
  const tax = lineTotalPaise - taxableValuePaise;
  if (isInterState) {
    return { taxableValuePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
  }
  const cgstPaise = Math.round(tax / 2);
  return { taxableValuePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0 };
}

const oneToNineteen = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
];

const tensWords = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function amountPaiseToIndianWords(totalPaise: number): string {
  const rupees = Math.floor(totalPaise / 100);
  const paise = Math.abs(totalPaise % 100);
  const rupeeWords = convertIndianNumberToWords(rupees);
  if (paise === 0) {
    return `${rupeeWords} Rupees Only`;
  }
  const paiseWords = convertIndianNumberToWords(paise);
  return `${rupeeWords} Rupees and ${paiseWords} Paise Only`;
}

function convertIndianNumberToWords(value: number): string {
  if (value <= 19) {
    return oneToNineteen[value] ?? 'Zero';
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const units = value % 10;
    return `${tensWords[tens]}${units ? ` ${oneToNineteen[units]}` : ''}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    return `${oneToNineteen[hundreds]} Hundred${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
  }
  if (value < 100000) {
    const thousands = Math.floor(value / 1000);
    const remainder = value % 1000;
    return `${convertIndianNumberToWords(thousands)} Thousand${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
  }
  if (value < 10000000) {
    const lakhs = Math.floor(value / 100000);
    const remainder = value % 100000;
    return `${convertIndianNumberToWords(lakhs)} Lakh${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
  }
  const crores = Math.floor(value / 10000000);
  const remainder = value % 10000000;
  return `${convertIndianNumberToWords(crores)} Crore${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
}

/** Order shape needed to render an invoice PDF (subset of the Prisma include below). */
type LoadedInvoiceOrder = {
  id: string;
  orderNumber: string;
  shippingAddress: Prisma.JsonValue | null;
  subtotal: number;
  shippingCharge: number;
  discountAmount: number;
  total: number;
  items: InvoiceOrderItem[];
};

const INVOICE_ORDER_INCLUDE = {
  user: {
    select: { email: true }
  },
  items: {
    include: {
      variant: {
        select: {
          hsnCode: true,
          gstRatePercent: true,
          product: {
            select: {
              attributes: true
            }
          }
        }
      }
    }
  }
} as const;

/**
 * Pure render step shared by first-time generation and self-heal regeneration:
 * builds the line items (GST carved out of the GST-inclusive amounts — never
 * added on top), totals, and amount-in-words, and returns the PDF buffer.
 * With GST billing off, rates/taxes are zeroed and the renderer produces a
 * plain "INVOICE" instead of a "TAX INVOICE". Never changes totals.
 */
async function renderInvoicePdfContent(
  order: LoadedInvoiceOrder,
  sellerProfile: SellerProfile,
  invoiceLogo: Awaited<ReturnType<typeof fetchInvoiceLogo>>,
  invoiceNumber: string
): Promise<Buffer> {
  const shippingAddress = (order.shippingAddress ?? {}) as ShippingAddress;
  const sellerState = sellerProfile.state;
  const buyerState = (shippingAddress.state ?? 'Unknown').trim();
  const isInterState = sellerState.toLowerCase() !== buyerState.toLowerCase();
  const gstBilling = sellerProfile.gstBillingEnabled;
  const lineItems: InvoiceLineItem[] = order.items.map((item: InvoiceOrderItem): InvoiceLineItem => {
    const attributes = item.variant?.product?.attributes ?? null;
    const taxRatePercent = gstBilling
      ? resolveLineItemGstRatePercent(item.variant?.gstRatePercent, attributes)
      : 0;
    const split = computeInclusiveGstSplit(item.totalPrice, taxRatePercent, isInterState);
    return {
      name: item.productName,
      hsnCode: resolveInvoiceHsnCode({
        variantHsnCode: item.variant?.hsnCode,
        productAttributes: attributes
      }),
      quantity: item.quantity,
      unitPricePaise: item.unitPrice,
      lineTotalPaise: item.totalPrice,
      taxRatePercent,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise
    };
  });

  const cgstPaise = lineItems.reduce((sum, item) => sum + item.cgstPaise, 0);
  const sgstPaise = lineItems.reduce((sum, item) => sum + item.sgstPaise, 0);
  const igstPaise = lineItems.reduce((sum, item) => sum + item.igstPaise, 0);
  const amountInWords = amountPaiseToIndianWords(order.total);

  return renderInvoicePdfBuffer({
    storeDisplayName: sellerProfile.storeName,
    logo: invoiceLogo,
    invoiceNumber,
    orderNumber: order.orderNumber,
    issuedAtIso: new Date().toISOString(),
    seller: {
      legalName: sellerProfile.legalName,
      addressLine: sellerProfile.addressLine,
      state: sellerState,
      gstin: sellerProfile.gstin,
      fssai: sellerProfile.fssai
    },
    buyer: {
      fullName: shippingAddress.fullName ?? 'Customer',
      addressLine: [shippingAddress.line1, shippingAddress.line2, shippingAddress.city].filter(Boolean).join(', '),
      state: buyerState,
      pincode: shippingAddress.pincode ?? 'N/A'
    },
    lineItems,
    subtotalPaise: order.subtotal,
    shippingPaise: order.shippingCharge,
    discountPaise: order.discountAmount,
    totalPaise: order.total,
    cgstPaise,
    sgstPaise,
    igstPaise,
    amountInWords,
    gstBilling
  });
}

/**
 * Self-heal for an order that already HAS an Invoice row but whose stored PDF is
 * missing (storage loss: wiped/replaced container filesystem before the shared
 * volume existed, host migration, manual delete). Re-renders the PDF under the
 * row's already-issued invoice number — the legal serial never changes — and
 * points pdfUrl at the fresh storage reference. Renders with CURRENT order data
 * and store settings (totals are immutable order fields, so amounts cannot
 * drift; presentation follows the current GST-billing mode). Returns null when
 * the order has no Invoice row (callers fall back to full generation).
 */
export async function regenerateInvoicePdfForOrder(
  prisma: PrismaClient,
  orderId: string,
  invoiceStorageAdapter: InvoiceStorageAdapter
): Promise<{ invoiceNumber: string; pdfUrl: string } | null> {
  const existingInvoice = await prisma.invoice.findUnique({
    where: { orderId },
    select: { id: true, invoiceNumber: true }
  });
  if (!existingInvoice) {
    return null;
  }

  const sellerProfile = await resolveSellerProfileOrThrow(prisma);
  const invoiceLogo = await resolveInvoiceLogo(sellerProfile);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: INVOICE_ORDER_INCLUDE
  });
  if (!order) {
    return null;
  }

  const content = await renderInvoicePdfContent(order, sellerProfile, invoiceLogo, existingInvoice.invoiceNumber);
  const uploaded = await invoiceStorageAdapter.uploadInvoicePdf({
    orderId: order.id,
    invoiceNumber: existingInvoice.invoiceNumber,
    content
  });

  await prisma.invoice.update({
    where: { id: existingInvoice.id },
    data: { pdfUrl: uploaded.storageReference }
  });

  return { invoiceNumber: existingInvoice.invoiceNumber, pdfUrl: uploaded.storageReference };
}

export async function generateInvoiceForOrder(
  prisma: PrismaClient,
  orderId: string,
  invoiceStorageAdapter: InvoiceStorageAdapter
): Promise<void> {
  if (!(await resolveGstInvoicingEnabled(prisma))) {
    return;
  }

  const sellerProfile = await resolveSellerProfileOrThrow(prisma);
  // Fetched OUTSIDE the transaction — a slow logo host must never hold a DB tx open.
  const invoiceLogo = await resolveInvoiceLogo(sellerProfile);

  await prisma.$transaction(async (tx) => {
    const existingInvoice = await tx.invoice.findUnique({
      where: { orderId }
    });
    if (existingInvoice) {
      return;
    }

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: INVOICE_ORDER_INCLUDE
    });
    if (!order) {
      return;
    }

    // HSN is OPTIONAL per line item (2026-07-11): a missing code renders as "N/A" on the
    // PDF instead of failing generation. The old hard throw here left orders permanently
    // invoice-less (the job retried into dead-letter) whenever ANY item lacked an HSN.
    // GST rules require HSN digits based on turnover — the merchant remains responsible
    // for filling codes on products where applicable; the HSN autofill suggestions in the
    // product editor make that easy.

    // Invoice number is DERIVED from the order number (see deriveInvoiceNumber) — no
    // sequence, no gaps, idempotent regeneration. The only collision surface is a
    // pre-existing sequence-era invoice (`INV-YYYY-#####`) clashing with a derived
    // number for a legacy sequential order ref (`ORD-YYYY-#####`). If that ever
    // happens, fall back to the `INVA-` series (multiple series are permitted under
    // CGST Rule 46(b)); a second collision is impossible in practice and throws.
    let invoiceNumber = deriveInvoiceNumber(order.orderNumber);
    const numberTakenByOtherOrder = await tx.invoice.findUnique({
      where: { invoiceNumber },
      select: { orderId: true }
    });
    if (numberTakenByOtherOrder && numberTakenByOtherOrder.orderId !== order.id) {
      invoiceNumber = `INVA-${order.orderNumber.replace(/^ORD-/, '')}`;
      const fallbackTaken = await tx.invoice.findUnique({
        where: { invoiceNumber },
        select: { orderId: true }
      });
      if (fallbackTaken && fallbackTaken.orderId !== order.id) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Invoice number collision for order ${order.orderNumber}: both derived series are already issued to other orders. Resolve the conflicting Invoice rows before regenerating.`,
          422
        );
      }
    }
    const content = await renderInvoicePdfContent(order, sellerProfile, invoiceLogo, invoiceNumber);

    const uploaded = await invoiceStorageAdapter.uploadInvoicePdf({
      orderId: order.id,
      invoiceNumber,
      content
    });

    await tx.invoice.create({
      data: {
        orderId: order.id,
        invoiceNumber,
        pdfUrl: uploaded.storageReference
      }
    });
  });
}
