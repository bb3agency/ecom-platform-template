import { apiClient, ApiError, type ApiClientOptions } from "@/lib/api";
import { refreshAccessToken } from "@/lib/auth-api";
import { shouldAttemptTokenRefresh, shouldForceLogin } from "@/lib/error-messages";

export interface AuthenticatedApiDeps {
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
  onAuthFailure: () => void;
}

type AuthenticatedOptions = ApiClientOptions & {
  _retryAfterRefresh?: boolean;
  _retriedAfterRateLimit?: boolean;
};

const RATE_LIMIT_RETRY_DELAY_MS = 1200;

export function createAuthenticatedApiClient(deps: AuthenticatedApiDeps) {
  return async function authenticatedApiClient<T>(
    endpoint: string,
    options: AuthenticatedOptions = {},
  ): Promise<T> {
    const { _retryAfterRefresh, _retriedAfterRateLimit, accessToken, ...rest } = options;
    const token = accessToken ?? deps.getAccessToken();

    try {
      return await apiClient<T>(endpoint, {
        ...rest,
        accessToken: token,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }

      if (
        shouldAttemptTokenRefresh(error) &&
        !_retryAfterRefresh
      ) {
        try {
          const refreshed = await refreshAccessToken();
          deps.setAccessToken(refreshed.accessToken);
          return await authenticatedApiClient<T>(endpoint, {
            ...rest,
            accessToken: refreshed.accessToken,
            _retryAfterRefresh: true,
          });
        } catch {
          deps.onAuthFailure();
          throw error;
        }
      }

      // Rapidly switching admin sections can burst past the per-minute rate
      // limit; a single delayed retry for idempotent GETs turns those panels'
      // "Something went wrong" flashes into a barely-noticeable pause.
      const isGet = !rest.method || rest.method.toUpperCase() === "GET";
      if (error.status === 429 && isGet && !_retriedAfterRateLimit) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
        return authenticatedApiClient<T>(endpoint, {
          ...rest,
          ...(token ? { accessToken: token } : {}),
          _retriedAfterRateLimit: true,
        });
      }

      if (shouldForceLogin(error) || (error.status === 401 && _retryAfterRefresh)) {
        deps.onAuthFailure();
      }

      throw error;
    }
  };
}
