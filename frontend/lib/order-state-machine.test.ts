import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ORDER_STATUS_TRANSITIONS, manualNextStatuses } from "./order-state-machine";

const BACKEND_FILE = resolve(__dirname, "../../backend/src/common/orders/order-state-machine.ts");

/** Parse `STATUS: ['A', 'B'],` lines out of the backend transition table. */
function parseBackendTransitions(source: string): Record<string, string[]> {
  const table = source.slice(source.indexOf("ORDER_STATUS_TRANSITIONS"));
  const body = table.slice(table.indexOf("{") + 1, table.indexOf("};"));
  const result: Record<string, string[]> = {};
  for (const match of body.matchAll(/([A-Z_]+):\s*\[([^\]]*)\]/g)) {
    result[match[1]] = [...match[2].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  }
  return result;
}

describe("order state machine mirror", () => {
  it.skipIf(!existsSync(BACKEND_FILE))("matches the backend transition table exactly", () => {
    const backend = parseBackendTransitions(readFileSync(BACKEND_FILE, "utf8"));
    expect(Object.keys(backend).length).toBe(9);
    const frontend = Object.fromEntries(
      Object.entries(ORDER_STATUS_TRANSITIONS).map(([k, v]) => [k, [...v]]),
    );
    expect(frontend).toEqual(backend);
  });
});

describe("manualNextStatuses", () => {
  it("never offers cancel (it has its own dialog) or a payment-less confirm", () => {
    expect(manualNextStatuses("CONFIRMED")).not.toContain("CANCELLED");
    expect(manualNextStatuses("PENDING_PAYMENT")).toEqual(["PAYMENT_FAILED"]);
  });

  it("offers refund only with the refund permission", () => {
    expect(manualNextStatuses("DELIVERED")).toEqual([]);
    expect(manualNextStatuses("DELIVERED", { canRefund: true })).toEqual(["REFUNDED"]);
  });

  it("skips the courier 'shipped' hop for local delivery", () => {
    expect(manualNextStatuses("PROCESSING", { isLocalDelivery: true })).toEqual(["OUT_FOR_DELIVERY"]);
    expect(manualNextStatuses("PROCESSING")).toEqual(["SHIPPED", "OUT_FOR_DELIVERY"]);
  });

  it("returns nothing for terminal or unknown statuses", () => {
    expect(manualNextStatuses("REFUNDED", { canRefund: true })).toEqual([]);
    expect(manualNextStatuses("NOT_A_STATUS")).toEqual([]);
  });
});
