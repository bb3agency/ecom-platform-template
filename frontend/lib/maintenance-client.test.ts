import { describe, it, expect } from "vitest";
import {
  shouldShowMaintenanceBanner,
  secondsUntilMaintenance,
  type MaintenanceStatus,
} from "@/lib/maintenance-client";

function status(over: Partial<MaintenanceStatus>): MaintenanceStatus {
  return {
    mode: "normal",
    phase: null,
    pendingUntil: null,
    activatedAt: null,
    serverTime: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    ...over,
  };
}

describe("maintenance-client / shouldShowMaintenanceBanner", () => {
  it("returns false for null status", () => {
    expect(shouldShowMaintenanceBanner(null)).toBe(false);
  });

  it("returns false for normal / reduced / emergency modes", () => {
    expect(shouldShowMaintenanceBanner(status({ mode: "normal" }))).toBe(false);
    expect(shouldShowMaintenanceBanner(status({ mode: "reduced" }))).toBe(false);
    expect(shouldShowMaintenanceBanner(status({ mode: "emergency" }))).toBe(false);
  });

  it("returns true for maintenance pending phase", () => {
    expect(
      shouldShowMaintenanceBanner(
        status({ mode: "maintenance", phase: "pending", pendingUntil: "2030-01-01T00:02:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("returns true for maintenance active phase (stale tab safety net)", () => {
    expect(
      shouldShowMaintenanceBanner(
        status({ mode: "maintenance", phase: "active", activatedAt: "2030-01-01T00:02:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("returns false for maintenance with null phase (transitional safety)", () => {
    expect(shouldShowMaintenanceBanner(status({ mode: "maintenance", phase: null }))).toBe(false);
  });
});

describe("maintenance-client / secondsUntilMaintenance", () => {
  it("returns 0 for null / non-maintenance / active phase", () => {
    expect(secondsUntilMaintenance(null)).toBe(0);
    expect(secondsUntilMaintenance(status({ mode: "normal" }))).toBe(0);
    expect(
      secondsUntilMaintenance(status({ mode: "maintenance", phase: "active" })),
    ).toBe(0);
  });

  it("aligns countdown with server clock (not local clock)", () => {
    // serverTime is 2030-01-01T00:00:00Z, pendingUntil is +120s. Expected = 120.
    const s = status({
      mode: "maintenance",
      phase: "pending",
      serverTime: "2030-01-01T00:00:00.000Z",
      pendingUntil: "2030-01-01T00:02:00.000Z",
    });
    expect(secondsUntilMaintenance(s)).toBe(120);
  });

  it("returns 0 once the deadline has passed (drain may still be in flight)", () => {
    const s = status({
      mode: "maintenance",
      phase: "pending",
      serverTime: "2030-01-01T00:05:00.000Z",
      pendingUntil: "2030-01-01T00:02:00.000Z",
    });
    expect(secondsUntilMaintenance(s)).toBe(0);
  });

  it("returns 0 when pendingUntil is malformed", () => {
    const s = status({
      mode: "maintenance",
      phase: "pending",
      serverTime: "2030-01-01T00:00:00.000Z",
      pendingUntil: "not-a-date",
    });
    expect(secondsUntilMaintenance(s)).toBe(0);
  });
});
