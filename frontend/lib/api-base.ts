/**
 * API base URL resolution.
 *
 * Browser auth cookies (`refresh_token`) are set on the request origin.
 * Per backend docs, the storefront must call `/api/v1` on the **same site** as the
 * UI (Next.js rewrite → backend in local dev; Nginx in production).
 */

const API_V1_PATH = "/api/v1";

function normalizeBase(url: string): string {
  return url.replace(/\/$/, "");
}

export function getConfiguredPublicApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return normalizeBase(configured);
  }
  if (process.env.NODE_ENV === "development") {
    return normalizeBase("http://localhost:3000/api/v1");
  }
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL is required in production builds. Set it in .env.production.local before npm run build.",
  );
}

export function getInternalApiBaseUrl(): string {
  const internal = process.env.INTERNAL_API_BASE_URL?.trim();
  if (internal) {
    return normalizeBase(internal);
  }
  return getConfiguredPublicApiBaseUrl();
}

/**
 * Base URL for browser `fetch` (client components, credentials: include).
 * Always uses the current page origin so refresh cookies and Next `/api/v1` rewrites
 * work on LAN/mobile hosts (e.g. `http://10.x.x.x:3101`), not `localhost` from env.
 */
export function getBrowserApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return getInternalApiBaseUrl();
  }

  const configured = getConfiguredPublicApiBaseUrl();
  if (configured.startsWith("/")) {
    return configured;
  }

  return `${new URL(window.location.href).origin}${API_V1_PATH}`;
}

/**
 * Base URL for Server Components, server actions, and Vitest integration tests.
 * Always prefers INTERNAL_API_BASE_URL so SSR/tests hit Fastify directly (not the Next rewrite).
 */
export function getServerApiBaseUrl(): string {
  return getInternalApiBaseUrl();
}

/** Context-aware resolver used by `apiClient`. */
export function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return getBrowserApiBaseUrl();
  }
  return getServerApiBaseUrl();
}
