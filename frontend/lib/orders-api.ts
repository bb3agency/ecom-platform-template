import { parseApiErrorFromResponse } from "@/lib/api";
import { storefrontApiClient } from "@/lib/storefront-api-client";
import { getBrowserApiBaseUrl } from "@/lib/api-base";
import { resolveDownloadFilename } from "@/lib/download-filename";
import { createIdempotencyKey } from "@/lib/idempotency";

export type CheckoutPaymentMode = "PREPAID" | "COD";

export interface CheckoutShippingAddressInput {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface CreateOrderInput {
  addressId?: string;
  shippingAddress?: CheckoutShippingAddressInput;
  notes?: string;
  paymentMode?: CheckoutPaymentMode;
  /** Backend-selected cheapest shipping provider from delivery rates response. */
  selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL";
  /** Rate shown to the customer by getDeliveryRates (paise). Ensures customer is charged exactly what was shown. */
  shippingChargePaise?: number;
  /** Shiprocket courier company ID from the quoted rate — ensures AWB uses the same courier that was priced. */
  courierCompanyId?: number;
}

export interface OrderLineItem {
  id: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /** PDP enrichment (customer order detail only) — slug for deep-linking back to the product. */
  productSlug?: string;
  /** First product image for the line thumbnail; null when the product has no images. */
  imageUrl?: string | null;
  /** True when both variant and product are still active (safe to link to the PDP). */
  isPurchasable?: boolean;
}

/** Customer-visible payment fields (provider references are stripped by the backend). */
export interface OrderPaymentSummary {
  provider: string;
  /** Paise. */
  amount: number;
  status: "CREATED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED" | string;
  method?: string | null;
  capturedAt?: string | null;
  /** Paise currently with the provider as an in-flight refund. */
  refundPendingAmountPaise?: number;
  /** Paise already refunded. */
  refundedAmountPaise?: number;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: CheckoutPaymentMode;
  shippingAddress: CheckoutShippingAddressInput;
  subtotal: number;
  shippingCharge: number;
  /** Shipping rate quoted at checkout (paise). Immutable — preserved even if shippingCharge is later adjusted. */
  shippingChargeQuotedPaise?: number | null;
  /** Provider locked at checkout — used for AWB assignment enforcement. */
  selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL" | null;
  /** Merchant-fulfilled local delivery order — no courier or AWB will ever exist. */
  isLocalDelivery?: boolean;
  discountAmount: number;
  couponCode?: string | null;
  total: number;
  createdAt?: string;
  items?: OrderLineItem[];
  /** Customer-visible return requests for this order (latest first; admin markers stripped). */
  returnRequests?: Array<{
    id: string;
    status: "REQUESTED" | "APPROVED" | "REJECTED" | "PICKED_UP" | "REFUNDED" | string;
    reason: string;
    adminNote: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  invoice?: { hasPdf: boolean; invoiceNumber: string; issuedAt: string } | null;
  /** Present on order detail / confirm responses; null for orders with no payment row. */
  payment?: OrderPaymentSummary | null;
  shipment?: {
    id: string;
    provider: string;
    status: string;
    awb: string | null;
    trackingUrl: string | null;
    events: Array<{
      status: string;
      location: string | null;
      description: string;
      occurredAt: string;
    }>;
  } | null;
}

export interface InitiatePaymentResponse {
  orderId: string;
  provider: string;
  providerOrderId: string;
  amount: number;
  currency: string;
}

export interface VerifyPaymentInput {
  orderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export async function createOrder(
  input: CreateOrderInput,
  accessToken: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<OrderSummary> {
  return storefrontApiClient<OrderSummary>("/orders", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: JSON.stringify(input),
  });
}

export async function initiatePayment(
  orderId: string,
  accessToken: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<InitiatePaymentResponse> {
  return storefrontApiClient<InitiatePaymentResponse>("/payments/initiate", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: JSON.stringify({ orderId }),
  });
}

export async function verifyPayment(
  input: VerifyPaymentInput,
  accessToken: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<{ message: string }> {
  return storefrontApiClient<{ message: string }>("/payments/verify", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: JSON.stringify(input),
  });
}

export interface PrepareCheckoutInput {
  addressId?: string;
  shippingAddress?: CheckoutShippingAddressInput;
  notes?: string;
  selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL";
  /** Rate shown to the customer by getDeliveryRates (paise). Ensures customer is charged exactly what was shown. */
  shippingChargePaise?: number;
  /** Shiprocket courier company ID from the quoted rate — ensures AWB uses the same courier that was priced. */
  courierCompanyId?: number;
}

export interface PrepareCheckoutResponse {
  checkoutSessionId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
}

export interface ConfirmPrepaidInput {
  checkoutSessionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export async function prepareCheckout(
  input: PrepareCheckoutInput,
  accessToken: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<PrepareCheckoutResponse> {
  return storefrontApiClient<PrepareCheckoutResponse>("/payments/prepare-checkout", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: JSON.stringify(input),
  });
}

export async function confirmPrepaid(
  input: ConfirmPrepaidInput,
  accessToken: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<OrderSummary> {
  return storefrontApiClient<OrderSummary>("/payments/confirm-prepaid", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: JSON.stringify(input),
  });
}

export async function retryPayment(
  orderId: string,
  accessToken: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<InitiatePaymentResponse> {
  return storefrontApiClient<InitiatePaymentResponse>("/payments/retry", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: JSON.stringify({ orderId }),
  });
}

export async function getMyOrder(id: string, accessToken: string): Promise<OrderSummary> {
  return storefrontApiClient<OrderSummary>(`/orders/${id}`, {
    method: "GET",
    accessToken,
  });
}

export async function cancelMyOrder(
  id: string,
  accessToken: string,
  reason?: string,
): Promise<{ message: string }> {
  return storefrontApiClient<{ message: string }>(`/orders/${id}/cancel`, {
    method: "POST",
    accessToken,
    idempotencyKey: createIdempotencyKey(),
    body: JSON.stringify({ reason }),
  });
}

export interface ReturnRequestItemInput {
  orderItemId: string;
  quantity: number;
  reason?: string;
}

export interface CreateReturnRequestInput {
  items: ReturnRequestItemInput[];
  reason: string;
}

export async function createReturnRequest(
  orderId: string,
  input: CreateReturnRequestInput,
  accessToken: string,
): Promise<{ id: string; status: string }> {
  return storefrontApiClient<{ id: string; status: string }>(`/orders/${orderId}/return-requests`, {
    method: "POST",
    accessToken,
    idempotencyKey: createIdempotencyKey(),
    body: JSON.stringify(input),
  });
}

/** Customer invoice PDF — requires Bearer token (customerGuard), not cookie-only. */
export async function downloadCustomerInvoicePdf(
  orderId: string,
  accessToken: string,
  filename: string,
): Promise<void> {
  const url = `${getBrowserApiBaseUrl()}/orders/${orderId}/invoice.pdf`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, "Unable to download invoice.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  // The server names the file after the invoice number it just rendered; the
  // caller's `filename` is only a fallback (see resolveDownloadFilename).
  anchor.download = resolveDownloadFilename(response, filename);
  anchor.click();
  // Deferred: revoking synchronously can abort the save in Firefox/Safari.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
