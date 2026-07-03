/**
 * Public storefront settings fetched from GET /api/v1/store/config.
 * No auth required. Used by RSC pages (cart, checkout) to enforce
 * minimum order value and COD availability without admin credentials.
 *
 * Uses native fetch with Next.js ISR (revalidate: 60s) so the value is
 * cached at the edge and re-validated in the background — storefront pages
 * won't hit the backend on every request.
 *
 * Falls back to fail-closed defaults if the backend is unreachable,
 * so the storefront never hard-crashes due to a settings fetch failure.
 */

import { getServerApiBaseUrl } from "@/lib/api-base";

export interface PublicStoreConfig {
  isCodEnabled: boolean;
  /** Minimum cart subtotal in paise. 0 means no minimum. */
  minOrderValuePaise: number;
  /**
   * When false (default), only email+password signup is shown to customers.
   * When true, customers also see the "Sign up with Mobile" OTP tab.
   * Toggled by the merchant from Admin → Settings → Store.
   */
  mobileOtpSignupEnabled: boolean;
  /** Merchant toggle from Admin → Coupons (StoreSettings.couponsEnabled). */
  couponsEnabled: boolean;
  reviewsEnabled: boolean;
  /** Merchant returns toggle — gates the customer return-request flow. */
  returnsEnabled: boolean;
  wishlistEnabled: boolean;
  gstInvoicingEnabled: boolean;
  /** Merchant store identity/contact (Admin → Settings → Store) — shown in footer/contact. */
  storeName: string | null;
  storeAddress: string | null;
  storeState: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** False when GET /store/config failed — block checkout until config loads. */
  configAvailable: boolean;
}

/** Fail closed — do not enable COD or signup when config fetch fails. */
const FAIL_CLOSED_CONFIG: PublicStoreConfig = {
  isCodEnabled: false,
  minOrderValuePaise: 0,
  mobileOtpSignupEnabled: false,
  couponsEnabled: false,
  reviewsEnabled: false,
  returnsEnabled: false,
  wishlistEnabled: false,
  gstInvoicingEnabled: false,
  storeName: null,
  storeAddress: null,
  storeState: null,
  contactEmail: null,
  contactPhone: null,
  configAvailable: false,
};

/** Parse GET /store/config JSON (enveloped or raw) into typed storefront settings. */
export function parsePublicStoreConfig(body: unknown): PublicStoreConfig {
  const data =
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    typeof (body as Record<string, unknown>).data === "object"
      ? (body as { data: unknown }).data
      : body;

  if (typeof data !== "object" || data === null) return FAIL_CLOSED_CONFIG;

  const record = data as Record<string, unknown>;
  return {
    isCodEnabled:
      typeof record.isCodEnabled === "boolean"
        ? record.isCodEnabled
        : FAIL_CLOSED_CONFIG.isCodEnabled,
    minOrderValuePaise:
      typeof record.minOrderValuePaise === "number" &&
      record.minOrderValuePaise >= 0
        ? record.minOrderValuePaise
        : FAIL_CLOSED_CONFIG.minOrderValuePaise,
    mobileOtpSignupEnabled:
      typeof record.mobileOtpSignupEnabled === "boolean"
        ? record.mobileOtpSignupEnabled
        : false,
    couponsEnabled:
      typeof record.couponsEnabled === "boolean"
        ? record.couponsEnabled
        : FAIL_CLOSED_CONFIG.couponsEnabled,
    reviewsEnabled:
      typeof record.reviewsEnabled === "boolean"
        ? record.reviewsEnabled
        : FAIL_CLOSED_CONFIG.reviewsEnabled,
    returnsEnabled:
      typeof record.returnsEnabled === "boolean"
        ? record.returnsEnabled
        : FAIL_CLOSED_CONFIG.returnsEnabled,
    wishlistEnabled:
      typeof record.wishlistEnabled === "boolean"
        ? record.wishlistEnabled
        : FAIL_CLOSED_CONFIG.wishlistEnabled,
    gstInvoicingEnabled:
      typeof record.gstInvoicingEnabled === "boolean"
        ? record.gstInvoicingEnabled
        : FAIL_CLOSED_CONFIG.gstInvoicingEnabled,
    storeName: typeof record.storeName === "string" ? record.storeName : null,
    storeAddress: typeof record.storeAddress === "string" ? record.storeAddress : null,
    storeState: typeof record.storeState === "string" ? record.storeState : null,
    contactEmail: typeof record.contactEmail === "string" ? record.contactEmail : null,
    contactPhone: typeof record.contactPhone === "string" ? record.contactPhone : null,
    configAvailable: true,
  };
}

export async function getPublicStoreConfig(): Promise<PublicStoreConfig> {
  try {
    const apiBase = getServerApiBaseUrl();
    const res = await fetch(`${apiBase}/store/config`, {
      // Revalidate every 60 s — admin changes take effect within a minute.
      // No credentials needed: this endpoint is public.
      next: { revalidate: 60 },
    });

    if (!res.ok) return FAIL_CLOSED_CONFIG;

    const body: unknown = await res.json();
    return parsePublicStoreConfig(body);
  } catch {
    // Network error, backend down, etc. — never crash the storefront.
    return FAIL_CLOSED_CONFIG;
  }
}

/** Client-side fetch for public store config (register page, etc.). */
export async function fetchPublicStoreConfigClient(): Promise<PublicStoreConfig> {
  const { getBrowserApiBaseUrl } = await import("@/lib/api-base");
  try {
    const apiBase = getBrowserApiBaseUrl();
    const res = await fetch(`${apiBase}/store/config`, { cache: "no-store" });
    if (!res.ok) return FAIL_CLOSED_CONFIG;
    const body: unknown = await res.json();
    return parsePublicStoreConfig(body);
  } catch {
    return FAIL_CLOSED_CONFIG;
  }
}
