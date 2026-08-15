import { describe, expect, it } from "vitest";
import {
  aspectRatioOf,
  buildJustifiedRows,
  FALLBACK_ASPECT_RATIO,
  formatPhotoDate,
  groupByMonth,
} from "./gallery-timeline";
import type { GalleryImage } from "./gallery-api";

function image(overrides: Partial<GalleryImage> & { id: string }): GalleryImage {
  return {
    imageUrl: `https://cdn.example.com/${overrides.id}.jpg`,
    caption: null,
    altText: "",
    sortOrder: 0,
    isActive: true,
    capturedAt: null,
    timelineDate: "2026-08-01T00:00:00.000Z",
    width: 1600,
    height: 1200,
    ...overrides,
  };
}

describe("groupByMonth", () => {
  it("splits photos into month sections, preserving the server's order", () => {
    const sections = groupByMonth([
      image({ id: "a", timelineDate: "2026-08-14T00:00:00.000Z" }),
      image({ id: "b", timelineDate: "2026-08-02T00:00:00.000Z" }),
      image({ id: "c", timelineDate: "2026-03-09T00:00:00.000Z" }),
    ]);

    expect(sections.map((s) => s.key)).toEqual(["2026-08", "2026-03"]);
    // Order within a month must be untouched — the server already applied the
    // merchant's manual sortOrder as a tie-break.
    expect(sections[0]?.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(sections[0]?.label).toContain("2026");
    expect(sections[1]?.items).toHaveLength(1);
  });

  it("keeps months from different years apart", () => {
    const sections = groupByMonth([
      image({ id: "a", timelineDate: "2026-01-05T00:00:00.000Z" }),
      image({ id: "b", timelineDate: "2025-01-05T00:00:00.000Z" }),
    ]);
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.year)).toEqual([2026, 2025]);
  });

  it("skips unparseable dates instead of crashing the page", () => {
    const sections = groupByMonth([
      image({ id: "bad", timelineDate: "not-a-date" }),
      image({ id: "good", timelineDate: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.items.map((i) => i.id)).toEqual(["good"]);
  });

  it("returns nothing for an empty gallery", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("aspectRatioOf", () => {
  it("uses real dimensions when present", () => {
    expect(aspectRatioOf({ width: 1600, height: 900 })).toBeCloseTo(16 / 9);
  });

  it("falls back for legacy rows with no dimensions, and never divides by zero", () => {
    expect(aspectRatioOf({ width: null, height: null })).toBe(FALLBACK_ASPECT_RATIO);
    expect(aspectRatioOf({ width: 100, height: 0 })).toBe(FALLBACK_ASPECT_RATIO);
  });
});

describe("buildJustifiedRows", () => {
  const opts = { containerWidth: 1000, targetRowHeight: 240, gap: 8 };

  it("fills each completed row to exactly the container width", () => {
    const images = Array.from({ length: 9 }, (_, i) =>
      image({ id: `i${i}`, width: 1600, height: 1200 }),
    );
    const rows = buildJustifiedRows(images, opts);

    expect(rows.length).toBeGreaterThan(1);
    // Every row except the last must span the full width (within rounding).
    for (const row of rows.slice(0, -1)) {
      const total =
        row.reduce((sum, tile) => sum + tile.width, 0) + opts.gap * (row.length - 1);
      expect(Math.abs(total - opts.containerWidth)).toBeLessThanOrEqual(row.length + 1);
    }
  });

  it("preserves each photo's aspect ratio", () => {
    const rows = buildJustifiedRows(
      [
        image({ id: "wide", width: 2000, height: 1000 }),
        image({ id: "tall", width: 1000, height: 2000 }),
        image({ id: "square", width: 1000, height: 1000 }),
      ],
      opts,
    );
    for (const tile of rows.flat()) {
      const expected = aspectRatioOf(tile.image);
      expect(tile.width / tile.height).toBeCloseTo(expected, 1);
    }
  });

  it("does not blow up a lone trailing photo to full width", () => {
    // The classic justified-layout eyesore: one leftover photo stretched across
    // the whole container.
    const rows = buildJustifiedRows([image({ id: "solo", width: 1600, height: 1200 })], opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]?.width).toBeLessThan(opts.containerWidth);
    expect(rows[0]?.[0]?.height).toBeLessThanOrEqual(opts.targetRowHeight * 1.5);
  });

  it("keeps every photo exactly once", () => {
    const images = Array.from({ length: 17 }, (_, i) => image({ id: `i${i}` }));
    const laid = buildJustifiedRows(images, opts).flat();
    expect(laid).toHaveLength(17);
    expect(new Set(laid.map((t) => t.image.id)).size).toBe(17);
  });

  it("degrades safely before the container has been measured", () => {
    // First paint runs with width 0 until the ResizeObserver reports.
    expect(buildJustifiedRows([image({ id: "a" })], { ...opts, containerWidth: 0 })).toEqual([]);
    expect(buildJustifiedRows([], opts)).toEqual([]);
  });

  it("never emits a zero or negative size on a narrow phone viewport", () => {
    const rows = buildJustifiedRows(
      Array.from({ length: 6 }, (_, i) => image({ id: `i${i}`, width: 4000, height: 1000 })),
      { containerWidth: 320, targetRowHeight: 140, gap: 6 },
    );
    for (const tile of rows.flat()) {
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
    }
  });
});

describe("formatPhotoDate", () => {
  it("renders a human date and tolerates bad input", () => {
    expect(formatPhotoDate("2026-03-14T00:00:00.000Z")).toMatch(/2026/);
    expect(formatPhotoDate("nope")).toBe("");
  });
});
