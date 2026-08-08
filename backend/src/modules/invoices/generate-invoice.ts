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

/**
 * Best-effort fetch of the store logo for the invoice header. Any failure (timeout,
 * non-image, unsupported format) returns null — the invoice renders text-only.
 * react-pdf embeds only PNG/JPG, so other formats are skipped by magic-byte sniff.
 */
export async function fetchInvoiceLogo(
  logoUrl: string | null
): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  const url = (logoUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 8 || bytes.length > 2 * 1024 * 1024) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { data: bytes, format: 'png' };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return { data: bytes, format: 'jpg' };
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveSellerProfileOrThrow(prisma: PrismaClient): Promise<SellerProfile> {
  const storeSettingsDelegate = (prisma as unknown as { storeSettings?: PrismaClient['storeSettings'] }).storeSettings;
  const settings = storeSettingsDelegate
    ? await storeSettingsDelegate.findUnique({
        where: { singletonKey: 'default' },
        select: {
          storeName: true,
          logoUrl: true,
          sellerLegalName: true,
          sellerAddress: true,
          sellerState: true,
          gstin: true,
          fssaiNumber: true
        }
      })
    : null;

  const legalName = (settings?.sellerLegalName ?? settings?.storeName ?? '').trim();
  const addressLine = (settings?.sellerAddress ?? '').trim();
  const state = (settings?.sellerState ?? '').trim();
  const gstin = (settings?.gstin ?? '').trim();
  const fssai = (settings?.fssaiNumber ?? '').trim();
  const requiresFssai = ['food', 'true', '1'].includes(String(process.env.STORE_REQUIRES_FSSAI ?? '').toLowerCase());

  if (requiresFssai && !fssai) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'FSSAI is required for invoice generation for food clients',
      500
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const missing = [
      !legalName ? 'StoreSettings.sellerLegalName' : null,
      !addressLine ? 'StoreSettings.sellerAddress' : null,
      !state ? 'StoreSettings.sellerState' : null,
      !gstin ? 'StoreSettings.gstin' : null,
      (!fssai && requiresFssai) ? 'StoreSettings.fssaiNumber' : null
    ].filter((value): value is string => value !== null);

    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Missing required DB-backed configuration for invoicing: ${missing.join(', ')}`,
        500
      );
    }
  }

  return {
    legalName: legalName || 'Ecom Store Pvt Ltd',
    addressLine: addressLine || 'Address not configured',
    state: state || 'Unknown',
    gstin: gstin || 'GSTIN_NOT_CONFIGURED',
    // FSSAI is OPTIONAL (2026-07-11) — empty means the PDF simply omits the FSSAI line
    // instead of printing a placeholder. STORE_REQUIRES_FSSAI still hard-enforces above.
    fssai: fssai || '',
    storeName: (settings?.storeName ?? '').trim() || legalName || 'Ecom Store Pvt Ltd',
    logoUrl: ((settings as { logoUrl?: string | null } | null)?.logoUrl ?? '').trim() || null
  };
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
  const invoiceLogo = await fetchInvoiceLogo(sellerProfile.logoUrl);

  await prisma.$transaction(async (tx) => {
    const existingInvoice = await tx.invoice.findUnique({
      where: { orderId }
    });
    if (existingInvoice) {
      return;
    }

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
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
      }
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

    await tx.$executeRaw`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1`;
    const sequenceResult = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('invoice_number_seq')`;
    const sequenceNumber = Number(sequenceResult[0]?.nextval ?? 1n);
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${String(sequenceNumber).padStart(5, '0')}`;
    const shippingAddress = (order.shippingAddress ?? {}) as ShippingAddress;
    const sellerState = sellerProfile.state;
    const buyerState = (shippingAddress.state ?? 'Unknown').trim();
    const isInterState = sellerState.toLowerCase() !== buyerState.toLowerCase();
    const lineItems: InvoiceLineItem[] = order.items.map((item: InvoiceOrderItem): InvoiceLineItem => {
      const attributes = item.variant?.product?.attributes ?? null;
      const taxRatePercent = resolveLineItemGstRatePercent(item.variant?.gstRatePercent, attributes);
      const lineTax = Math.round((item.totalPrice * taxRatePercent) / 100);
      const cgst = isInterState ? 0 : Math.round(lineTax / 2);
      const sgst = isInterState ? 0 : lineTax - cgst;
      const igst = isInterState ? lineTax : 0;
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
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst
      };
    });

    const cgstPaise = lineItems.reduce((sum, item) => sum + item.cgstPaise, 0);
    const sgstPaise = lineItems.reduce((sum, item) => sum + item.sgstPaise, 0);
    const igstPaise = lineItems.reduce((sum, item) => sum + item.igstPaise, 0);
    const amountInWords = amountPaiseToIndianWords(order.total);

    const content = await renderInvoicePdfBuffer({
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
      amountInWords
    });

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
