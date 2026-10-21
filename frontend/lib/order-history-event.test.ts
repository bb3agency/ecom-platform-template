import { describe, expect, it } from "vitest";

import { cleanHistoryNote, describeHistoryEvent } from "./order-history-event";

describe("describeHistoryEvent", () => {
  it("reads a status change as the status it moved to", () => {
    expect(describeHistoryEvent({ fromStatus: "SHIPPED", toStatus: "CANCELLED", note: "Shipment status changed to CANCELED" }))
      .toMatchObject({ kind: "status", label: "Cancelled" });
  });

  it("never shows a refund row as 'Shipped' — legacy rows written under the pre-cancel status", () => {
    const view = describeHistoryEvent({
      fromStatus: "SHIPPED",
      toStatus: "SHIPPED",
      note: "Refund initiated (108572 paise) by shipping_webhook",
    });
    expect(view).toEqual({ kind: "refund-attempted", label: "Refund attempted", note: "Refund initiated (₹1,085.72)" });
  });

  it("labels the new refund notes by what happened to the money", () => {
    const row = (note: string) => describeHistoryEvent({ fromStatus: "CANCELLED", toStatus: "CANCELLED", note });
    expect(row("Refund sent to provider (500 paise) — ref rfnd_1").label).toBe("Refund started");
    expect(row("Refund failed (500 paise): Low balance. Retrying automatically for up to 3 days.").kind).toBe("refund-failed");
    expect(row("Refund failed at provider (500 paise) — ref rfnd_1. Retrying automatically.").kind).toBe("refund-failed");
    expect(row("Refund still owed (500 paise) — automatic retries stopped").kind).toBe("refund-owed");
    expect(row("Refund retry requested (500 paise) [admin:abc-123]")).toMatchObject({
      kind: "refund-retry",
      note: "Refund retry requested (₹5)",
    });
  });

  it("keeps the real 'Refund processed' status change as Refunded", () => {
    expect(describeHistoryEvent({ fromStatus: "CANCELLED", toStatus: "REFUNDED", note: "Refund processed (500 paise)" }))
      .toMatchObject({ kind: "status", label: "Refunded" });
  });
});

describe("cleanHistoryNote", () => {
  it("drops the admin audit tag", () => {
    expect(cleanHistoryNote("Cancelled by admin [admin:1f2e]")).toBe("Cancelled by admin");
  });
});
