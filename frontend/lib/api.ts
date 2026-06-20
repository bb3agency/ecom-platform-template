import { resolveApiBaseUrl } from "@/lib/api-base";
import type { ApiEnvelope, ApiErrorBody } from "@/types/api";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: ApiErrorBody["details"],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions extends RequestInit {
  accessToken?: string | null;
  idempotencyKey?: string;
}

function getApiBase(): string {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Configure frontend/.env.local.",
    );
  }
  return base;
}

function isEnvelope<T>(body: unknown): body is ApiEnvelope<T> {
  return (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    "data" in body
  );
}

function parseApiError(body: unknown, status: number): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error?: ApiErrorBody }).error;
    return new ApiError(
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? "Request failed",
      status,
      err?.details,
    );
  }
  return new ApiError("UNKNOWN_ERROR", "Request failed", status);
}

function requestTimeoutMs(path: string): number {
  if (path.startsWith("/auth/")) {
    return 12_000;
  }
  return 30_000;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal;

  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(
        "REQUEST_TIMEOUT",
        "Request timed out",
        408,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: ApiClientOptions = {},
): Promise<T> {
  const { accessToken, idempotencyKey, headers, ...init } = options;
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${getApiBase()}${path}`;

  const isFormData = init.body instanceof FormData;

  const hasBody = init.body !== undefined && init.body !== null;

  const response = await fetchWithTimeout(
    url,
    {
      ...init,
      credentials: "include",
      headers: {
        ...(hasBody && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...headers,
      },
    },
    requestTimeoutMs(path),
  );

  const body: unknown = await response.json().catch(() => ({}));

  if (isEnvelope<T>(body)) {
    if (!body.success) {
      throw parseApiError(body, response.status);
    }
    const envelope = body as ApiEnvelope<T>;
    const meta = envelope.meta;
    if (
      Array.isArray(envelope.data) &&
      meta &&
      typeof meta === "object" &&
      typeof meta.page === "number" &&
      typeof meta.limit === "number" &&
      typeof meta.total === "number" &&
      typeof meta.totalPages === "number"
    ) {
      return {
        items: envelope.data,
        meta: {
          page: meta.page,
          limit: meta.limit,
          total: meta.total,
          totalPages: meta.totalPages,
        },
      } as T;
    }
    return envelope.data as T;
  }

  if (!response.ok) {
    throw parseApiError(body, response.status);
  }

  return body as T;
}
