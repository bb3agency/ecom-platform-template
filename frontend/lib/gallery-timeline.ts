import type { GalleryImage } from "@/lib/gallery-api";

/**
 * Layout maths for the storefront gallery timeline — the phone-gallery pattern:
 * photos grouped into dated sections, laid out in JUSTIFIED rows that preserve
 * each photo's aspect ratio rather than square-cropping every tile.
 *
 * Pure functions in core `lib/` so every client shares one implementation (and
 * it is unit-testable); the visual shell lives in each client's theme layer.
 *
 * The row packing is the classic greedy "fill to width, then scale the row to
 * fit" used by Flickr/Google Photos: accumulate photos until their combined
 * width at the target height exceeds the container, then scale that row so it
 * fills the width exactly. Cheap, stable, and good enough at gallery scale —
 * Google's optimal Knuth–Plass variant only earns its complexity across
 * thousands of tiles.
 */

/** Aspect ratio to assume when a photo predates dimension capture. */
export const FALLBACK_ASPECT_RATIO = 4 / 3;

export function aspectRatioOf(image: Pick<GalleryImage, "width" | "height">): number {
  if (!image.width || !image.height || image.height <= 0) return FALLBACK_ASPECT_RATIO;
  return image.width / image.height;
}

export interface TimelineSection {
  /** Stable key for React and for scroll targets, e.g. `2026-08`. */
  key: string;
  /** Heading shown in the sticky header, e.g. `August 2026`. */
  label: string;
  /** Short label for the scrub rail, e.g. `Aug`. */
  shortLabel: string;
  year: number;
  items: GalleryImage[];
}

/**
 * Groups photos into month sections, newest first, preserving the server's
 * within-month order. The server already sorted by effective date, so this only
 * partitions — it must not re-sort, or a merchant's manual `sortOrder` tie-break
 * would be lost.
 */
export function groupByMonth(items: GalleryImage[], locale = "en-IN"): TimelineSection[] {
  const sections: TimelineSection[] = [];
  const index = new Map<string, TimelineSection>();

  for (const item of items) {
    const date = new Date(item.timelineDate);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    let section = index.get(key);
    if (!section) {
      section = {
        key,
        label: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date),
        shortLabel: new Intl.DateTimeFormat(locale, { month: "short" }).format(date),
        year: date.getFullYear(),
        items: [],
      };
      index.set(key, section);
      sections.push(section);
    }
    section.items.push(item);
  }

  return sections;
}

/** `14 March 2026` — the per-photo date shown in the lightbox. */
export function formatPhotoDate(iso: string, locale = "en-IN"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export interface JustifiedTile {
  image: GalleryImage;
  /** Rendered size in CSS pixels. */
  width: number;
  height: number;
}

export type JustifiedRow = JustifiedTile[];

export interface JustifiedLayoutOptions {
  containerWidth: number;
  targetRowHeight: number;
  gap: number;
  /** Cap on how tall the last (unfilled) row may be scaled. */
  maxRowHeight?: number;
}

/**
 * Packs images into justified rows that exactly fill `containerWidth`.
 *
 * The final row is deliberately NOT stretched to full width — a single leftover
 * photo blown up to the container width is the classic justified-layout eyesore.
 * It keeps the target height, capped by `maxRowHeight`.
 */
export function buildJustifiedRows(
  images: GalleryImage[],
  options: JustifiedLayoutOptions,
): JustifiedRow[] {
  const { containerWidth, targetRowHeight, gap } = options;
  const maxRowHeight = options.maxRowHeight ?? targetRowHeight * 1.5;
  if (images.length === 0 || containerWidth <= 0 || targetRowHeight <= 0) return [];

  const rows: JustifiedRow[] = [];
  let current: GalleryImage[] = [];
  let currentRatioSum = 0;

  const flush = (isLastRow: boolean) => {
    if (current.length === 0) return;
    const totalGap = gap * (current.length - 1);
    const available = containerWidth - totalGap;
    // Row height that makes the row's scaled widths sum to `available`.
    let rowHeight = available / currentRatioSum;
    if (isLastRow) rowHeight = Math.min(rowHeight, maxRowHeight);

    rows.push(
      current.map((image) => {
        const ratio = aspectRatioOf(image);
        return {
          image,
          width: Math.max(1, Math.round(ratio * rowHeight)),
          height: Math.max(1, Math.round(rowHeight)),
        };
      }),
    );
    current = [];
    currentRatioSum = 0;
  };

  for (const image of images) {
    const ratio = aspectRatioOf(image);
    const projectedGap = gap * current.length; // gaps once this image joins
    const projectedWidth = (currentRatioSum + ratio) * targetRowHeight + projectedGap;

    current.push(image);
    currentRatioSum += ratio;

    if (projectedWidth >= containerWidth) {
      flush(false);
    }
  }
  flush(true);

  return rows;
}
