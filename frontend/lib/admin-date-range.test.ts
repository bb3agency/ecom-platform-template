import { describe, expect, it } from "vitest";
import {
  defaultDateRange,
  rangeToISO,
  spanDays,
  trendPeriodLabel,
} from "@/components/admin/AdminDateRangePicker";

describe("AdminDateRangePicker helpers", () => {
  it("defaultDateRange returns a 7-day inclusive window ending today", () => {
    const range = defaultDateRange();
    expect(range.from <= range.to).toBe(true);
    expect(spanDays(range.from, range.to)).toBe(7);
  });

  it("rangeToISO returns an ordered inclusive day window", () => {
    const { fromISO, toISO } = rangeToISO("2026-05-01", "2026-05-07");
    const fromMs = new Date(fromISO).getTime();
    const toMs = new Date(toISO).getTime();
    expect(fromMs).toBeLessThan(toMs);
    expect(spanDays("2026-05-01", "2026-05-07")).toBe(7);
  });

  it("trendPeriodLabel reflects span length", () => {
    expect(trendPeriodLabel("2026-05-01", "2026-05-01")).toBe("vs yesterday");
    expect(trendPeriodLabel("2026-05-01", "2026-05-07")).toBe("vs prev 7 days");
  });
});
