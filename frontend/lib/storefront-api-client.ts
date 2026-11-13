import { apiClient, type ApiClientOptions } from "@/lib/api";
import {
  createAuthenticatedApiClient,
  type AuthenticatedApiDeps,
} from "@/lib/authenticated-api";

/**
 * Refresh-aware client for customer (storefront) API calls.
 *
 * Customer access tokens live 15 minutes and are held in memory only. The
 * storefront API modules (orders, payments, cart, addresses, reviews,
 * wishlist) receive a token captured at render time, so without this wrapper
 * every customer call started failing with 401 once a long-lived SPA session
 * outlived the token. On 401 TOKEN_EXPIRED/UNAUTHORISED this client runs the
 * single-flight cookie refresh, stores the new token, and retries ONCE with the
 * same options — including the same `idempotencyKey`, so a retried mutation
 * can never execute twice.
 *
 * Session wiring is injected by `stores/auth` (`registerStorefrontAuth`) so
 * these lib modules stay importable from server code: with no registration
 * (server actions, SSR) or no token (guest cart calls) it is a plain
 * `apiClient` call.
 */
let registeredDeps: AuthenticatedApiDeps | null = null;

const delegatingDeps: AuthenticatedApiDeps = {
  getAccessToken: () => registeredDeps?.getAccessToken() ?? null,
  setAccessToken: (token) => registeredDeps?.setAccessToken(token),
  onAuthFailure: () => registeredDeps?.onAuthFailure(),
};

const authenticatedClient = createAuthenticatedApiClient(delegatingDeps);

export function registerStorefrontAuth(deps: AuthenticatedApiDeps | null): void {
  registeredDeps = deps;
}

export function storefrontApiClient<T>(
  endpoint: string,
  options: ApiClientOptions = {},
): Promise<T> {
  if (!registeredDeps || !options.accessToken) {
    return apiClient<T>(endpoint, options);
  }
  return authenticatedClient<T>(endpoint, options);
}
