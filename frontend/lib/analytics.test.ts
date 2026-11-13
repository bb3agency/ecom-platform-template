import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalyticsStateForTests, trackEvent, trackEventOnce } from "@/lib/analytics";

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

function installWindow(localStorage: Pick<Storage, "getItem" | "setItem">) {
  vi.stubGlobal("window", {
    localStorage,
    location: { href: "http://shop.test/checkout", origin: "http://shop.test" },
  });
}

function sentBody(callIndex = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("analytics", () => {
  beforeEach(() => {
    resetAnalyticsStateForTests();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "/api/v1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("never throws when storage access is blocked (SecurityError)", () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    installWindow({ getItem: blocked, setItem: blocked });

    expect(() => trackEvent("CHECKOUT_STARTED")).not.toThrow();
    expect(() => trackEvent("PURCHASE", { orderId: "o1" })).not.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Falls back to a stable in-memory session id.
    expect(sentBody(0).sessionId).toBeTruthy();
    expect(sentBody(0).sessionId).toBe(sentBody(1).sessionId);
  });

  it("persists the session id when storage works", () => {
    const store = new Map<string, string>();
    installWindow({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
    });
    trackEvent("SEARCH");
    expect(store.size).toBe(1);
    expect(sentBody(0).sessionId).toBe([...store.values()][0]);
  });

  it("trackEventOnce sends an event once per dedupe key (no double PURCHASE)", () => {
    installWindow({ getItem: () => "sid", setItem: () => undefined });
    expect(trackEventOnce("purchase:o1", "PURCHASE", { orderId: "o1" })).toBe(true);
    expect(trackEventOnce("purchase:o1", "PURCHASE", { orderId: "o1" }, "user_1")).toBe(false);
    expect(trackEventOnce("purchase:o2", "PURCHASE", { orderId: "o2" })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
