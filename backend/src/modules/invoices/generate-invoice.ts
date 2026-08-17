import { type Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { type InvoiceStorageAdapter } from '@common/interfaces/invoice-storage.interface';
import { renderInvoicePdfBuffer } from '@modules/invoices/invoice-renderer';
import {
  resolveInvoiceHsnCode,
  resolveLineItemGstRatePercent
} from '@common/shipping/product-tax-fields';
import {
  buildOrderGstTaxLines,
  computeInclusiveGstSplit,
  type GstTaxLineInput
} from '@common/gst/inclusive-gst';
import { computeEffectiveGstBillingEnabled } from '@common/gst/gst-billing';
import { classifyInterStateSupply } from '@common/gst/pincode-state';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';

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
 * The invoice NUMBER is SEQUENTIAL (`INV-<year>-<seq>`, see
 * computeNextSequentialInvoiceNumber) and allocated exactly once, inside the same
 * transaction that creates the row — regeneration/self-heal reuses the stored
 * number, so re-rendering never consumes a serial and never leaves a gap.
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
  /** Snapshotted per-unit net weight in grams; null for count-based goods. */
  weightGrams?: number | null;
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
  /**
   * Admin-provided origin pincode (StoreSettings.pickupPincode / ops overlay).
   * Primary signal for intra vs inter-state classification — the typed state
   * string is only the fallback (see @common/gst/pincode-state).
   */
  pincode: string | null;
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
          gstBillingEnabled: true,
          gstInvoicingEnabled: true
        }
      })
    : null;

  // Origin pincode for place-of-supply classification: StoreSettings.pickupPincode
  // first, ops-config/env overlay second (same chain shipping quotes use).
  const pincode = storeSettingsDelegate ? await resolvePickupPincode(prisma) : null;

  const legalName = (settings?.sellerLegalName ?? settings?.storeName ?? '').trim();
  const addressLine = (settings?.sellerAddress ?? '').trim();
  const state = (settings?.sellerState ?? '').trim();
  const gstin = (settings?.gstin ?? '').trim();
  const fssai = (settings?.fssaiNumber ?? '').trim();
  const gstBillingSetting = (settings as { gstBillingEnabled?: boolean | null } | null)?.gstBillingEnabled;
  const gstInvoicingSetting = (settings as { gstInvoicingEnabled?: boolean | null } | null)
    ?.gstInvoicingEnabled;

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
    pincode,
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
    // GST appears on the invoice only when BOTH switches allow it — the exact
    // rule the checkout tax breakup uses (see @common/gst/gst-billing): the
    // GST-invoicing master flag AND the merchant GST-billing toggle
    // (auto-default = on when a GSTIN exists). Turning either off yields a
    // plain INVOICE instead of blocking invoicing entirely.
    gstBillingEnabled: computeEffectiveGstBillingEnabled({
      gstInvoicingEnabled: gstInvoicingSetting ?? null,
      gstBillingEnabled: gstBillingSetting ?? null,
      gstin
    })
  };
}

/**
 * SEQUENTIAL invoice numbering — `INV-<year>-<seq>` (e.g. `INV-2026-00042`),
 * reinstated 2026-08-10 by explicit merchant decision (consecutive serials are
 * what CAs/GST officers expect on the books), replacing the short-lived
 * order-derived scheme.
 *
 * Properties the old (pre-derived) counter implementation lacked, all preserved:
 *  - **Allocated ONCE per order**, inside the same transaction that creates the
 *    Invoice row. Regeneration/self-heal reuses the stored number, so re-rendering
 *    never burns a serial and never leaves a gap (the defect that motivated the
 *    derived scheme).
 *  - **No counter table**: the next number is max(existing sequence for the
 *    year) + 1, and the `invoiceNumber` UNIQUE constraint arbitrates concurrent
 *    allocations — the loser retries with a fresh scan (see generateInvoiceForOrder).
 *  - **Per-year reset** (matches the legacy series and CGST Rule 46(b)'s
 *    "unique for a financial year"); 5-digit zero-padding keeps `INV-2026-00042`
 *    at 14 chars, inside the 16-char serial limit, and the parser accepts longer
 *    sequences should a year ever exceed 99,999 invoices.
 *  - Rows from the derived era (`INV-AB2C-9XYZ`) don't parse as sequences and are
 *    simply skipped by the scan — both formats coexist under the global unique
 *    constraint.
 */
export function formatSequentialInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, '0')}`;
}

/** Minimal delegate shape so the allocator runs on PrismaClient AND $transaction clients. */
type InvoiceNumberScanClient = {
  invoice: {
    findMany(args: {
      where: { invoiceNumber: { startsWith: string } };
      select: { invoiceNumber: true };
      orderBy: { invoiceNumber: 'desc' };
      take: number;
    }): Promise<Array<{ invoiceNumber: string }>>;
  };
};

/**
 * Next free sequential number for `year`: scans the top rows under the year's
 * prefix (a bounded batch — non-sequence rows like a derived `INV-2026-XYZ1` ref
 * or lexicographic stragglers are filtered out by the numeric parse) and returns
 * max + 1, starting at 1 for a fresh year. Exported for tests.
 */
export async function computeNextSequentialInvoiceNumber(
  client: InvoiceNumberScanClient,
  now: Date = new Date()
): Promise<string> {
  const year = now.getFullYear();
  const prefix = `INV-${year}-`;
  const candidates = await client.invoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
    orderBy: { invoiceNumber: 'desc' },
    take: 25
  });
  let maxSequence = 0;
  for (const row of candidates) {
    const match = /^INV-\d{4}-(\d{5,})$/.exec(row.invoiceNumber);
    if (match) {
      maxSequence = Math.max(maxSequence, Number(match[1]));
    }
  }
  return formatSequentialInvoiceNumber(year, maxSequence + 1);
}

/**
 * The GST carve-out math lives in @common/gst/inclusive-gst (2026-08-10) so the
 * checkout tax breakup and the invoice PDF share one implementation and one
 * rounding policy. Re-exported here under the historical names for existing
 * imports and tests.
 */
export { computeInclusiveGstSplit };
export type InvoiceTaxLineInput = GstTaxLineInput;
export const buildInvoiceTaxLines = buildOrderGstTaxLines;

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
  // Place-of-supply: pincodes are the primary signal (admin pickup pincode vs
  // shipping-address pincode); typed state strings only disambiguate/fall back.
  const { isInterState } = classifyInterStateSupply({
    seller: { pincode: sellerProfile.pincode, stateName: sellerState },
    buyer: { pincode: shippingAddress.pincode, stateName: shippingAddress.state }
  });
  const gstBilling = sellerProfile.gstBillingEnabled;
  const lineItems = buildInvoiceTaxLines({
    items: order.items.map((item: InvoiceOrderItem) => {
      const attributes = item.variant?.product?.attributes ?? null;
      return {
        name: item.productName,
        hsnCode: resolveInvoiceHsnCode({
          variantHsnCode: item.variant?.hsnCode,
          productAttributes: attributes
        }),
        quantity: item.quantity,
        weightGrams: item.weightGrams ?? null,
        unitPricePaise: item.unitPrice,
        lineTotalPaise: item.totalPrice,
        taxRatePercent: gstBilling
          ? resolveLineItemGstRatePercent(item.variant?.gstRatePercent, attributes)
          : 0
      };
    }),
    // Delivery/shipping is intentionally NOT in the tax base and NOT an item row —
    // it is billed untaxed in the totals section only (merchant policy 2026-08-10).
    discountPaise: order.discountAmount,
    isInterState
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
      state: (shippingAddress.state ?? 'Unknown').trim(),
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
    gstBilling,
    isInterState
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

/** Prisma P2002 = unique-constraint violation — the sequence race signal. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function generateInvoiceForOrder(
  prisma: PrismaClient,
  orderId: string,
  invoiceStorageAdapter: InvoiceStorageAdapter
): Promise<void> {
  // NOT gated on the GST flag — every order gets a document. With GST off it renders as
  // a plain "INVOICE" with no tax columns (see SellerProfile.gstBillingEnabled).
  const sellerProfile = await resolveSellerProfileOrThrow(prisma);
  // Fetched OUTSIDE the transaction — a slow logo host must never hold a DB tx open.
  const invoiceLogo = await resolveInvoiceLogo(sellerProfile);

  // Sequence race: two orders generating concurrently can both compute the same
  // next number; the invoiceNumber UNIQUE constraint aborts the loser. Retrying
  // re-runs the whole transaction — the fresh scan sees the winner's row and
  // allocates the next free serial. Three attempts covers realistic contention;
  // beyond that, surface the failure (the queue path retries the job anyway).
  const MAX_ALLOCATION_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    try {
      await generateInvoiceForOrderOnce(prisma, orderId, invoiceStorageAdapter, sellerProfile, invoiceLogo);
      return;
    } catch (error) {
      if (isUniqueConstraintViolation(error) && attempt < MAX_ALLOCATION_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
}

async function generateInvoiceForOrderOnce(
  prisma: PrismaClient,
  orderId: string,
  invoiceStorageAdapter: InvoiceStorageAdapter,
  sellerProfile: SellerProfile,
  invoiceLogo: Awaited<ReturnType<typeof fetchInvoiceLogo>>
): Promise<void> {
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

    // SEQUENTIAL number, allocated exactly once per order (see
    // computeNextSequentialInvoiceNumber). Two concurrent generations can race to
    // the same number — the UNIQUE constraint on invoiceNumber aborts the loser's
    // transaction, and the retry loop around this $transaction re-scans.
    const invoiceNumber = await computeNextSequentialInvoiceNumber(tx);
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
