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
};

export function createAuthenticatedApiClient(deps: AuthenticatedApiDeps) {
  return async function authenticatedApiClient<T>(
    endpoint: string,
    options: AuthenticatedOptions = {},
  ): Promise<T> {
    const { _retryAfterRefresh, accessToken, ...rest } = options;
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

      if (shouldForceLogin(error) || (error.status === 401 && _retryAfterRefresh)) {
        deps.onAuthFailure();
      }

      throw error;
    }
  };
}
