import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeClockOffsetMs,
  getServerClockOffsetMs,
  resetServerClockOffsetForTests,
  secondsUntilServerTime,
} from "@/lib/server-clock";

beforeEach(() => {
  resetServerClockOffsetForTests();
});

describe("computeClockOffsetMs", () => {
  it("is negative when the client clock runs ahead of the server", () => {
    const server = Date.parse("2030-01-01T00:00:00.000Z");
    const clientAhead = server + 10 * 60_000;
    // 200 ms round trip, server stamped at the midpoint.
    expect(
      computeClockOffsetMs("2030-01-01T00:00:00.000Z", clientAhead - 100, clientAhead + 100),
    ).toBe(-10 * 60_000);
  });

  it("returns 0 for an unparseable server time", () => {
    expect(computeClockOffsetMs("garbage", 0, 10)).toBe(0);
  });
});

describe("secondsUntilServerTime", () => {
  it("keeps a fresh OTP valid when the laptop clock is 10 min ahead", () => {
    const serverNow = Date.parse("2030-01-01T00:00:00.000Z");
    const expiresAt = new Date(serverNow + 5 * 60_000).toISOString();
    const clientNow = serverNow + 10 * 60_000;
    // Raw client clock: already "expired" — the bug.
    expect(secondsUntilServerTime(expiresAt, clientNow, 0)).toBe(0);
    // Server-aligned: the full 5 minutes remain.
    expect(secondsUntilServerTime(expiresAt, clientNow, -10 * 60_000)).toBe(300);
  });

  it("returns null for an invalid target", () => {
    expect(secondsUntilServerTime("nope", Date.now(), 0)).toBeNull();
  });
});

describe("getServerClockOffsetMs", () => {
  it("caches the offset and shares one in-flight request", async () => {
    const fetchServerTime = vi.fn(async () => ({ serverTime: new Date(Date.now() + 60_000).toISOString() }));
    const [a, b] = await Promise.all([
      getServerClockOffsetMs(fetchServerTime),
      getServerClockOffsetMs(fetchServerTime),
    ]);
    await getServerClockOffsetMs(fetchServerTime);
    expect(fetchServerTime).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(Math.abs(a - 60_000)).toBeLessThan(1_000);
  });

  it("falls back to 0 without caching when the server is unreachable", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await getServerClockOffsetMs(failing)).toBe(0);
    expect(await getServerClockOffsetMs(failing)).toBe(0);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
