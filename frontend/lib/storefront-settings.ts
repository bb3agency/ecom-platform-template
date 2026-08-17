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
  /** Merchant gallery toggle (Admin → Gallery) — gates the storefront /gallery route + nav link. */
  galleryEnabled: boolean;
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
  /** Merchant social links (Admin → Settings → Store) — footer icons. WhatsApp derives from contactPhone. */
  facebookUrl: string | null;
  instagramUrl: string | null;
  /**
   * Bot-challenge contract for the auth forms, decided by the SERVER.
   *
   * The storefront used to decide this itself from build-time
   * `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. When a deploy omitted that variable while the
   * API had `TURNSTILE_SECRET_KEY` set, no widget rendered, no token was sent, and
   * every login/register/OTP/forgot-password request was rejected with
   * "Challenge token is required" — a silent, total auth outage. Reading `required`
   * from the same place that enforces it makes that disagreement impossible.
   *
   * `siteKey` is null on backends that do not publish one; callers then fall back to
   * the build-time env var, so older deployments keep working.
   */
  authChallenge: AuthChallengeConfig;
  /** False when GET /store/config failed — block checkout until config loads. */
  configAvailable: boolean;
}

export interface AuthChallengeConfig {
  required: boolean;
  provider: "turnstile";
  siteKey: string | null;
}

/** Fail closed — do not enable COD or signup when config fetch fails. */
const FAIL_CLOSED_CONFIG: PublicStoreConfig = {
  isCodEnabled: false,
  minOrderValuePaise: 0,
  mobileOtpSignupEnabled: false,
  couponsEnabled: false,
  reviewsEnabled: false,
  galleryEnabled: false,
  returnsEnabled: false,
  wishlistEnabled: false,
  gstInvoicingEnabled: false,
  storeName: null,
  storeAddress: null,
  storeState: null,
  contactEmail: null,
  contactPhone: null,
  facebookUrl: null,
  instagramUrl: null,
  // Fail OPEN on the challenge only: when config is unreachable we cannot know
  // whether the API enforces one, and the caller falls back to its own env. Failing
  // closed here would block every login whenever /store/config hiccups.
  authChallenge: { required: false, provider: "turnstile", siteKey: null },
  configAvailable: false,
};

/**
 * Older backends (< backend-core 0.2.0) do not send `authChallenge`. Treat that as
 * "not required" so the caller falls back to its build-time site key rather than
 * blocking sign-in against an API that never asked for a token.
 */
function parseAuthChallenge(value: unknown): AuthChallengeConfig {
  if (typeof value !== "object" || value === null) {
    return { required: false, provider: "turnstile", siteKey: null };
  }
  const record = value as Record<string, unknown>;
  return {
    required: typeof record.required === "boolean" ? record.required : false,
    provider: "turnstile",
    siteKey: typeof record.siteKey === "string" && record.siteKey.trim() ? record.siteKey : null,
  };
}

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
    galleryEnabled:
      typeof record.galleryEnabled === "boolean"
        ? record.galleryEnabled
        : FAIL_CLOSED_CONFIG.galleryEnabled,
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
    facebookUrl: typeof record.facebookUrl === "string" ? record.facebookUrl : null,
    instagramUrl: typeof record.instagramUrl === "string" ? record.instagramUrl : null,
    authChallenge: parseAuthChallenge(record.authChallenge),
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
