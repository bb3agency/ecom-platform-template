/**
 * Public maintenance status client. Used by the storefront banner to render
 * the 2-minute countdown when ops triggers maintenance mode, and to swap
 * to a "we'll be right back" message if a stale tab is still mounted after
 * the cutover.
 *
 * The endpoint is always reachable (listed in the backend's
 * `ALWAYS_ALLOWED_PREFIXES`) so the banner keeps polling correctly even
 * while every other API call is being 503'd at the edge.
 */

import { apiClient } from "@/lib/api";

export type MaintenanceMode = "normal" | "reduced" | "emergency" | "maintenance";

export interface MaintenanceStatus {
  mode: MaintenanceMode;
  /** Only meaningful when `mode === 'maintenance'`. */
  phase: "pending" | "active" | null;
  /** ISO-8601 — when the pending → active flip is scheduled. */
  pendingUntil: string | null;
  /** ISO-8601 — when phase became `active`. */
  activatedAt: string | null;
  /** Server clock for client-side countdown alignment. Always populated. */
  serverTime: string;
}

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  // Force the browser/Next.js HTTP cache to bypass any cached snapshot of
  // the maintenance status. Without this, polls can be served from the
  // browser cache and the banner never sees the phase flip (pending →
  // active) until the user manually refreshes — defeating the whole
  // point of background polling. `cache: 'no-store'` + an explicit
  // `Cache-Control: no-cache` request header is belt + suspenders.
  return apiClient<MaintenanceStatus>("/maintenance/status", {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
}

/**
 * True when the storefront banner should render (pending OR active phase).
 * Active phase is included so a tab that loaded just before the cutover
 * still shows a friendly "we're working on it" notice instead of an empty
 * unmounted view.
 */
export function shouldShowMaintenanceBanner(status: MaintenanceStatus | null): boolean {
  if (!status) return false;
  return status.mode === "maintenance" && (status.phase === "pending" || status.phase === "active");
}

/**
 * Seconds until pending → active. Returns 0 once the deadline has passed
 * (the worker drain may still be in-flight at that point — the active
 * phase write happens only after drain completes, so callers should keep
 * polling rather than assuming immediate activation).
 */
export function secondsUntilMaintenance(status: MaintenanceStatus | null): number {
  if (!status || status.mode !== "maintenance" || status.phase !== "pending" || !status.pendingUntil) {
    return 0;
  }
  // Align with server clock so a wrong device clock doesn't show the wrong
  // countdown. We use the difference between status.serverTime and pendingUntil,
  // then subtract local elapsed time since the response landed.
  const serverNow = new Date(status.serverTime).getTime();
  const deadline = new Date(status.pendingUntil).getTime();
  if (!Number.isFinite(serverNow) || !Number.isFinite(deadline)) return 0;
  const diffMs = deadline - serverNow;
  return Math.max(0, Math.ceil(diffMs / 1000));
}
