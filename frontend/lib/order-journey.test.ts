import { describe, expect, it } from "vitest";

import { buildOrderJourney } from "./order-journey";

const created = "2026-10-20T10:00:00.000Z";
const states = (j: ReturnType<typeof buildOrderJourney>) => j.stages.map((s) => `${s.status}:${s.state}`);

describe("buildOrderJourney", () => {
  it("marks passed stages done (not clickable), the current one current, and valid moves next", () => {
    const j = buildOrderJourney({
      status: "PROCESSING",
      createdAt: created,
      history: [{ toStatus: "PROCESSING", createdAt: "2026-10-20T12:00:00.000Z", triggeredBy: "ADMIN" }],
    });
    expect(states(j)).toEqual([
      "CONFIRMED:done",
      "PROCESSING:current",
      "SHIPPED:next",
      "OUT_FOR_DELIVERY:next",
      "DELIVERED:locked", // can't deliver before it ships
    ]);
    expect(j.stages[0].at).toBe(created); // confirmed falls back to order creation
    expect(j.stages[1].source).toBe("Manual");
  });

  it("labels courier-driven stages as courier updates", () => {
    const j = buildOrderJourney({
      status: "OUT_FOR_DELIVERY",
      createdAt: created,
      history: [
        { toStatus: "SHIPPED", createdAt: "2026-10-21T09:00:00.000Z", triggeredBy: "SHIPPING_WEBHOOK" },
        { toStatus: "OUT_FOR_DELIVERY", createdAt: "2026-10-22T08:00:00.000Z", triggeredBy: "SHIPPING_WEBHOOK" },
      ],
    });
    expect(states(j)).toEqual([
      "CONFIRMED:done",
      "PROCESSING:done", // skipped hop still counts as passed
      "SHIPPED:done",
      "OUT_FOR_DELIVERY:current",
      "DELIVERED:next",
    ]);
    expect(j.stages[2].source).toBe("Courier update");
    expect(j.stages[1].at).toBeNull();
  });

  it("uses the local flow without a courier 'shipped' stage", () => {
    const j = buildOrderJourney({ status: "PROCESSING", isLocalDelivery: true, createdAt: created, history: [] });
    expect(j.stages.map((s) => s.status)).toEqual(["CONFIRMED", "PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(states(j)).toContain("OUT_FOR_DELIVERY:next");
  });

  it("leaves nothing clickable once delivered, except refund with permission", () => {
    const plain = buildOrderJourney({ status: "DELIVERED", createdAt: created, history: [] });
    expect(plain.stages.every((s) => s.state === "done" || s.state === "current")).toBe(true);
    expect(plain.canMarkRefunded).toBe(false);
    expect(buildOrderJourney({ status: "DELIVERED", createdAt: created, history: [], canRefund: true }).canMarkRefunded).toBe(true);
  });

  it("reports cancelled orders as off-track, keeping progress made before the cancel", () => {
    const j = buildOrderJourney({
      status: "CANCELLED",
      createdAt: created,
      history: [
        { toStatus: "SHIPPED", createdAt: "2026-10-21T09:00:00.000Z", triggeredBy: "SHIPPING_WEBHOOK" },
        { toStatus: "CANCELLED", createdAt: "2026-10-21T10:00:00.000Z", triggeredBy: "ADMIN" },
      ],
    });
    expect(j.offTrack?.label).toBe("Cancelled");
    expect(states(j)).toEqual([
      "CONFIRMED:done",
      "PROCESSING:done",
      "SHIPPED:done",
      "OUT_FOR_DELIVERY:locked",
      "DELIVERED:locked",
    ]);
  });

  it("treats an unpaid order as off-track with nothing to advance manually", () => {
    const j = buildOrderJourney({ status: "PENDING_PAYMENT", createdAt: created, history: [] });
    expect(j.offTrack?.status).toBe("PENDING_PAYMENT");
    expect(j.stages.every((s) => s.state === "locked")).toBe(true);
    expect(j.canMarkPaymentFailed).toBe(true);
  });
});
