import { getBrowserApiBaseUrl } from "@/lib/api-base";
import { STORAGE_PREFIX } from "@/lib/constants";

const SESSION_KEY = `${STORAGE_PREFIX}_analytics_sid`;

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for insecure contexts (like mobile testing over local network HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Used when storage is blocked (privacy mode, disabled site data, some webviews). */
let memorySessionId: string | null = null;

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  // localStorage access itself can throw SecurityError — analytics must never
  // take a page (checkout, order success) down to the error boundary.
  try {
    let sid = window.localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = generateUUID();
      window.localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    memorySessionId ??= generateUUID();
    return memorySessionId;
  }
}

type AnalyticsEventType =
  | "PRODUCT_VIEW"
  | "ADD_TO_CART"
  | "CHECKOUT_STARTED"
  | "PAYMENT_INITIATED"
  | "PURCHASE"
  | "SEARCH";

export function trackEvent(
  eventType: AnalyticsEventType,
  payload?: Record<string, unknown>,
  userId?: string,
): void {
  if (typeof window === "undefined") return;
  let base: string;
  try {
    base = getBrowserApiBaseUrl();
  } catch {
    return;
  }

  const body: Record<string, unknown> = {
    eventType,
    sessionId: getSessionId(),
    ...(userId ? { userId } : {}),
    ...(payload ? { payload } : {}),
  };

  void fetch(`${base}/analytics/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // fire-and-forget — never throw
  });
}

/** Dedupe keys already sent this page lifetime (SPA navigations included). */
const sentOnceKeys = new Set<string>();

/**
 * Fire an event at most once per `dedupeKey` — for effects that re-run as the
 * session restores (userId undefined → set), so PURCHASE / CHECKOUT_STARTED
 * are not double-counted on a hard load. Returns true when the event was sent.
 */
export function trackEventOnce(
  dedupeKey: string,
  eventType: AnalyticsEventType,
  payload?: Record<string, unknown>,
  userId?: string,
): boolean {
  if (typeof window === "undefined") return false;
  if (sentOnceKeys.has(dedupeKey)) return false;
  sentOnceKeys.add(dedupeKey);
  trackEvent(eventType, payload, userId);
  return true;
}

/** Test-only: forget dedupe keys and the in-memory session id. */
export function resetAnalyticsStateForTests(): void {
  sentOnceKeys.clear();
  memorySessionId = null;
}
