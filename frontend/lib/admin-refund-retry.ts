/**
 * "Retry refund" on a refund-owed order only *queues* a worker job
 * (POST /admin/orders/:id/refund/retry — see backend REFUND_LIFECYCLE.md §5); the
 * Razorpay call happens later and can fail again on the same low balance. The
 * confirmation must say "queued", never "sent", and the order is re-read a few
 * times so the refund-owed banner clears (or updates) once the worker reports back.
 */
export const REFUND_RETRY_QUEUED_MESSAGE =
  "Refund retry queued. This order updates once Razorpay responds.";

/** Re-read the order at these offsets after a queued retry. */
export const REFUND_RETRY_FOLLOW_UP_MS: readonly number[] = [4_000, 12_000, 30_000];

/** Schedules `refresh` at each delay; returns a cancel function (call it on unmount). */
export function scheduleRefundRetryFollowUps(
  refresh: () => void,
  delays: readonly number[] = REFUND_RETRY_FOLLOW_UP_MS,
): () => void {
  const timers = delays.map((delay) => setTimeout(refresh, delay));
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
