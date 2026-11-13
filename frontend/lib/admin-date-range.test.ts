import { describe, expect, it } from "vitest";
import {
  defaultDateRange,
  prevRange,
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

  it("rangeToISO covers whole local days, through the last millisecond", () => {
    const { fromISO, toISO } = rangeToISO("2026-11-01", "2026-11-07");
    expect(fromISO).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).toISOString());
    expect(toISO).toBe(new Date(2026, 10, 7, 23, 59, 59, 999).toISOString());
  });

  it("prevRange is the same-length window of whole local days before `from`", () => {
    const prev = prevRange("2026-11-08", "2026-11-14");
    expect(prev.from).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).toISOString());
    // Includes all of 7 Nov (it used to stop at 7 Nov 00:00, a 6-day window).
    expect(prev.to).toBe(new Date(2026, 10, 7, 23, 59, 59, 999).toISOString());
  });

  it("prevRange for a single day is the whole previous day", () => {
    const prev = prevRange("2026-11-08", "2026-11-08");
    expect(prev.from).toBe(new Date(2026, 10, 7, 0, 0, 0, 0).toISOString());
    expect(prev.to).toBe(new Date(2026, 10, 7, 23, 59, 59, 999).toISOString());
  });

  it("trendPeriodLabel reflects span length", () => {
    expect(trendPeriodLabel("2026-05-01", "2026-05-01")).toBe("vs yesterday");
    expect(trendPeriodLabel("2026-05-01", "2026-05-07")).toBe("vs prev 7 days");
  });
});
