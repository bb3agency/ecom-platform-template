/**
 * Server-clock alignment for console countdowns (ops OTP expiry, maintenance
 * cutover). `expiresAt` / `pendingUntil` are server timestamps; comparing them to
 * a skewed laptop clock made every fresh OTP look expired (clock ahead) or let a
 * countdown overrun (clock behind).
 *
 * The offset comes from the public, rate-limit-exempt `GET /maintenance/status`,
 * which always carries `serverTime`. Round-trip latency is split evenly
 * (NTP-style midpoint). Without a reading the offset is 0, i.e. the old behaviour.
 */
import { fetchMaintenanceStatus } from "@/lib/maintenance-client";

/** `serverTime - client midpoint`, in ms. Positive when the client clock is behind. */
export function computeClockOffsetMs(
  serverTimeIso: string,
  requestStartedAtMs: number,
  responseReceivedAtMs: number,
): number {
  const serverMs = new Date(serverTimeIso).getTime();
  if (!Number.isFinite(serverMs)) return 0;
  const midpoint = requestStartedAtMs + (responseReceivedAtMs - requestStartedAtMs) / 2;
  return Math.round(serverMs - midpoint);
}

/** Whole seconds from server-aligned "now" until `targetIso`; 0 once passed; null if unparseable. */
export function secondsUntilServerTime(
  targetIso: string,
  clientNowMs: number,
  offsetMs: number,
): number | null {
  const target = new Date(targetIso).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((target - (clientNowMs + offsetMs)) / 1000));
}

const OFFSET_TTL_MS = 10 * 60_000;
let cached: { offsetMs: number; at: number } | null = null;
let inflight: Promise<number> | null = null;

/** Cached server-clock offset (refreshed every 10 min). Resolves 0 when the server is unreachable. */
export function getServerClockOffsetMs(
  fetchServerTime: () => Promise<{ serverTime: string }> = fetchMaintenanceStatus,
): Promise<number> {
  if (cached && Date.now() - cached.at < OFFSET_TTL_MS) return Promise.resolve(cached.offsetMs);
  if (inflight) return inflight;
  const startedAt = Date.now();
  inflight = fetchServerTime()
    .then((status) => {
      const offsetMs = computeClockOffsetMs(status.serverTime, startedAt, Date.now());
      cached = { offsetMs, at: Date.now() };
      return offsetMs;
    })
    .catch(() => 0) // not cached: try again next time
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test hook: forget the cached offset. */
export function resetServerClockOffsetForTests(): void {
  cached = null;
  inflight = null;
}
