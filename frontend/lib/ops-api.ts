/**
 * Server-only ops helpers (metrics scrape). Authenticated ops calls use
 * `lib/ops-client-api.ts` from the browser with `credentials: "include"`.
 */
import { ApiError } from "@/lib/api";
import { assertOpsUiAccessFromServerAction } from "@/lib/ops-ui-auth";
import { headers } from "next/headers";

const OPS_BASE_URL = (() => {
  const internal = process.env.INTERNAL_API_BASE_URL?.trim();
  if (internal) return internal.replace(/\/$/, "");
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000/api/v1";
  }
  throw new Error("INTERNAL_API_BASE_URL or NEXT_PUBLIC_API_BASE_URL is required for ops metrics.");
})();

export type {
  OpsSession,
  OpsLoadShedStatus,
  OpsConfigOverview,
  OpsStoredConfig,
} from "@/lib/ops-client-api";

export async function getOpsMetricsSnapshot(): Promise<string> {
  if (typeof window === "undefined") {
    await assertOpsUiAccessFromServerAction();
  }

  const requestHeaders = await headers();
  const forwardedCookie = requestHeaders.get("cookie");
  const forwardedAuthorization = requestHeaders.get("authorization");
  const metricsToken = process.env.OPS_METRICS_TOKEN;
  const url = `${OPS_BASE_URL.replace(/\/$/, "")}/ops/metrics`;
  const outboundHeaders: Record<string, string> = {};
  if (metricsToken) {
    outboundHeaders["x-ops-token"] = metricsToken;
  }
  if (forwardedCookie) {
    outboundHeaders.cookie = forwardedCookie;
  }
  if (forwardedAuthorization) {
    outboundHeaders.authorization = forwardedAuthorization;
  }
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: Object.keys(outboundHeaders).length > 0 ? outboundHeaders : undefined,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errorCode =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { code?: string } }).error?.code === "string"
        ? (body as { error: { code: string } }).error.code
        : "UNKNOWN_ERROR";
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Ops metrics request failed";
    throw new ApiError(errorCode, message, response.status);
  }

  return response.text();
}
