import { ApiError } from "@/lib/api";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { CheckoutPaymentMode } from "@/lib/orders-api";

/**
 * Pure checkout-submit logic, kept out of CheckoutForm so it is unit-testable:
 * idempotency-key reuse across retries, prepaid-confirmation retry, the submit
 * button's blocked/label state, saved-address de-duplication and the payment
 * page's sign-in redirect guard.
 */

// ── Retryable errors ─────────────────────────────────────────────────────────

/**
 * True when the request may have reached (or may still be running on) the
 * backend and the SAME request should be retried with the SAME idempotency key:
 * client timeout, network failure, 5xx/503, and 409 "already processing".
 * 4xx answers are final — the backend caches them against the key, so retrying
 * a corrected request needs a fresh key.
 */
export function isRetryableCheckoutError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.code === "REQUEST_TIMEOUT" || error.status === 408) return true;
    if (error.status === 409 && error.code === "CONFLICT") return true;
    return error.status >= 500;
  }
  // fetch() rejects with a TypeError on network failure (offline, DNS, reset).
  return error instanceof TypeError;
}

/** Outcome unknown: the order may have been created even though we got no answer. */
export function isOutcomeUnknownError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === "REQUEST_TIMEOUT" || error.status === 408 || error.status === 504;
  }
  return error instanceof TypeError;
}

// ── Price changed between cart and checkout ──────────────────────────────────

export interface PriceChangedItem {
  variantId: string;
  previousPricePaise: number;
  currentPricePaise: number;
}

/**
 * 409 PRICE_CHANGED from POST /orders or /payments/prepare-checkout: a price
 * moved after the customer saw it. The backend has already re-priced the cart,
 * so the fix is to reload cart + delivery quote and let the customer review the
 * new total. The 4xx is final for its idempotency key (next submit gets new keys).
 */
export function isPriceChangedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "PRICE_CHANGED";
}

/** `error.details.items` of a PRICE_CHANGED error; malformed entries are dropped. */
export function getPriceChangedItems(error: unknown): PriceChangedItem[] {
  if (!isPriceChangedError(error)) return [];
  const items = error.details?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is PriceChangedItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.variantId === "string" &&
      typeof candidate.previousPricePaise === "number" &&
      typeof candidate.currentPricePaise === "number"
    );
  });
}

export interface RefreshAfterPriceChangeDeps<TCart> {
  /** Reloads the (already re-priced) cart from the backend. */
  loadCart: () => Promise<TCart>;
  setCart: (cart: TCart) => void;
  /** Re-requests the delivery quote (tax breakup depends on line prices). */
  requote: () => void;
}

/**
 * Reload cart and quote after PRICE_CHANGED so the updated total shows. Never
 * throws: if the reload fails the error banner stays and the next submit (or a
 * page refresh) picks the new prices up. Returns whether the cart was reloaded.
 */
export async function refreshAfterPriceChange<TCart>({
  loadCart,
  setCart,
  requote,
}: RefreshAfterPriceChangeDeps<TCart>): Promise<boolean> {
  let reloaded = false;
  try {
    setCart(await loadCart());
    reloaded = true;
  } catch {
    // Keep the last known cart; the PRICE_CHANGED message stays visible.
  }
  requote();
  return reloaded;
}

// ── Idempotency keys across submit retries ───────────────────────────────────

export interface SubmitAttemptKeys {
  /** Identity of the submitted payload — a different payload never reuses keys. */
  fingerprint: string;
  orderKey: string;
  prepareKey: string;
  /** Set after a retryable failure: the next identical submit replays these keys. */
  reusable: boolean;
}

/**
 * Keys for this submit. Reuses the previous keys only when the previous attempt
 * failed retryably AND the payload is identical — so a retry after a timeout
 * replays the original order instead of creating a second one (or failing with
 * "Cart is empty" because the first one already consumed the cart).
 */
export function resolveSubmitAttemptKeys(
  previous: SubmitAttemptKeys | null,
  fingerprint: string,
  createKey: () => string = createIdempotencyKey,
): SubmitAttemptKeys {
  if (previous && previous.reusable && previous.fingerprint === fingerprint) {
    return { ...previous, reusable: false };
  }
  return { fingerprint, orderKey: createKey(), prepareKey: createKey(), reusable: false };
}

/** After a failure: keep the keys for an identical retry only if it was retryable. */
export function settleSubmitAttemptKeys(
  keys: SubmitAttemptKeys,
  error: unknown,
): SubmitAttemptKeys {
  return { ...keys, reusable: isRetryableCheckoutError(error) };
}

export interface CheckoutFingerprintInput {
  paymentMode: CheckoutPaymentMode;
  /** The exact request body — the backend rejects a reused key with a different body. */
  payload: unknown;
}

/**
 * Identity of a checkout attempt. Deliberately excludes the local cart: after a
 * timed-out COD order the backend has already emptied the cart, and a cart
 * resync must not turn the customer's retry into a new key (→ "Cart is empty").
 */
export function buildCheckoutFingerprint({ paymentMode, payload }: CheckoutFingerprintInput): string {
  return JSON.stringify({ paymentMode, payload });
}

// ── Prepaid confirmation retry ───────────────────────────────────────────────

export interface ConfirmRetryOptions {
  /** Delays between attempts (ms); attempts = delays.length + 1. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CONFIRM_DELAYS_MS = [1_000, 2_500] as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs confirm-prepaid with bounded backoff on retryable failures. The caller
 * passes the SAME payload + idempotency key on every attempt (the backend makes
 * confirm idempotent per key and payment), so retrying can never create a
 * second order. 401 refresh is handled one layer down by storefrontApiClient.
 */
export async function confirmWithRetry<T>(
  confirm: () => Promise<T>,
  { delaysMs = DEFAULT_CONFIRM_DELAYS_MS, sleep = defaultSleep }: ConfirmRetryOptions = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await confirm();
    } catch (error) {
      if (attempt >= delaysMs.length || !isRetryableCheckoutError(error)) {
        throw error;
      }
      await sleep(delaysMs[attempt]);
      attempt += 1;
    }
  }
}

// ── Submit button state ──────────────────────────────────────────────────────

export interface CheckoutSubmitStateInput {
  submitting: boolean;
  configAvailable: boolean;
  belowMinOrder: boolean;
  blockedLocalDelivery: boolean;
  /** A captured Razorpay payment is waiting for order confirmation. */
  pendingConfirmation: boolean;
  pincodeComplete: boolean;
  shippingQuoteLoading: boolean;
  /** A delivery quote exists for the CURRENT pincode + payment mode. */
  hasShippingQuote: boolean;
  paymentMode: CheckoutPaymentMode;
}

export interface CheckoutSubmitState {
  disabled: boolean;
  label: string;
  shortLabel: string;
}

/**
 * Submit is blocked while the delivery quote is loading, and for COD when no
 * quote exists for this pincode/mode — the customer must see the delivery
 * charge before committing to a COD total. Prepaid can continue without a
 * quote: Razorpay shows the backend-computed amount before anything is paid.
 */
export function getCheckoutSubmitState(input: CheckoutSubmitStateInput): CheckoutSubmitState {
  const blocked = (label: string, shortLabel = label): CheckoutSubmitState => ({
    disabled: true,
    label,
    shortLabel,
  });

  if (input.pendingConfirmation) return blocked("Payment received. Confirm your order below", "Confirm below");
  if (input.submitting) return blocked("Processing…");
  if (!input.configAvailable) return blocked("Store settings unavailable", "Unavailable");
  if (input.belowMinOrder) return blocked("Minimum order not met");
  if (input.blockedLocalDelivery) return blocked("Remove undeliverable items to continue", "Remove items");
  if (input.pincodeComplete && input.shippingQuoteLoading) {
    return blocked("Calculating delivery…", "Calculating…");
  }
  if (input.paymentMode === "COD" && input.pincodeComplete && !input.hasShippingQuote) {
    return blocked("Delivery charge unavailable for COD", "Delivery unavailable");
  }
  return {
    disabled: false,
    label: input.paymentMode === "COD" ? "Place Order — Cash on Delivery" : "Place Order — Pay Online",
    shortLabel: "Place order",
  };
}

// ── Saved-address de-duplication ─────────────────────────────────────────────

export interface CheckoutAddressFields {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
}

function normaliseAddressField(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A saved address identical to the entered one, if any. Used before
 * "Save this address" creates a new address book entry, so a retry after a
 * dismissed payment modal or failed order reuses the entry instead of
 * duplicating it.
 */
export function findMatchingSavedAddress<T extends CheckoutAddressFields & { id: string }>(
  saved: readonly T[],
  entered: CheckoutAddressFields,
): T | undefined {
  const keys: Array<keyof CheckoutAddressFields> = [
    "fullName",
    "phone",
    "line1",
    "line2",
    "city",
    "state",
    "pincode",
  ];
  return saved.find((address) =>
    keys.every(
      (key) => normaliseAddressField(address[key]) === normaliseAddressField(entered[key]),
    ),
  );
}

// ── Payment page sign-in guard ───────────────────────────────────────────────

export interface PaymentLoginRedirectInput {
  isReady: boolean;
  orderId: string | null;
  accessToken: string | null;
  sessionStatus: "checking" | "authenticated" | "guest";
}

/** Redirect to sign-in only once the session check has finished with no token. */
export function shouldRedirectPaymentToLogin({
  isReady,
  orderId,
  accessToken,
  sessionStatus,
}: PaymentLoginRedirectInput): boolean {
  if (!isReady || !orderId) return false;
  if (accessToken) return false;
  return sessionStatus !== "checking";
}
