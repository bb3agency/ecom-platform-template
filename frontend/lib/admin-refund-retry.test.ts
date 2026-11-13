import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFUND_RETRY_FOLLOW_UP_MS,
  REFUND_RETRY_QUEUED_MESSAGE,
  scheduleRefundRetryFollowUps,
} from "@/lib/admin-refund-retry";

afterEach(() => {
  vi.useRealTimers();
});

describe("refund retry feedback", () => {
  it("says the retry was queued, not that the refund was sent", () => {
    expect(REFUND_RETRY_QUEUED_MESSAGE.toLowerCase()).toContain("queued");
    expect(REFUND_RETRY_QUEUED_MESSAGE.toLowerCase()).not.toContain("sent");
  });

  it("re-reads the order at each follow-up delay", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    scheduleRefundRetryFollowUps(refresh);
    vi.advanceTimersByTime(REFUND_RETRY_FOLLOW_UP_MS[REFUND_RETRY_FOLLOW_UP_MS.length - 1]);
    expect(refresh).toHaveBeenCalledTimes(REFUND_RETRY_FOLLOW_UP_MS.length);
  });

  it("stops refreshing once cancelled (notice unmounted / refund cleared)", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const cancel = scheduleRefundRetryFollowUps(refresh, [1_000, 5_000]);
    vi.advanceTimersByTime(1_000);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
