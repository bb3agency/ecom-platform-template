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

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = generateUUID();
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
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
  const base = getBrowserApiBaseUrl();

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
