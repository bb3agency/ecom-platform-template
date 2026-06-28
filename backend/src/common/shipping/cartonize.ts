/**
 * cartonize.ts — Compute the ACTUAL shipping box dimensions for an order so the
 * dimensions sent to Shiprocket/Delhivery match the parcel that will really ship
 * (couriers bill volumetric weight = L×W×H ÷ 5000, so wrong dims → wrong billing).
 *
 * Two modes (see PLATFORM guide / Ops config):
 *  1. CATALOG  — if standard carton sizes are configured, pick the SMALLEST real
 *                box the items physically fit into (3D feasibility check).
 *  2. COMPUTED — otherwise, 3D-pack the items (with rotation) into the tightest
 *                enclosing bounding box.
 * In both modes a safety padding (default +2 cm/side) is added for void-fill +
 * carton walls so the parcel is never undersized.
 *
 * The packer is a conservative Extreme-Point First-Fit-Decreasing heuristic: when
 * uncertain it errs toward a LARGER box, never a smaller one — so the billed box is
 * never undersized. Exact 3D bin packing is NP-hard; this is accurate and fast for
 * the small line-item counts of real e-commerce orders.
 */

export type CartonItem = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
  quantity: number;
};

export type BoxDimensions = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type CartonBoxPreset = BoxDimensions & { name: string; maxWeightGrams?: number };

export type CartonResult = BoxDimensions & {
  weightGrams: number;
  /** How the box was decided — for diagnostics/audit. */
  source: 'catalog' | 'computed' | 'single-item' | 'default-fallback';
  boxName?: string;
};

/** Per-unit fallback box when a variant has no dimensions configured (cm). */
export const DEFAULT_UNIT_BOX: BoxDimensions = { lengthCm: 15, widthCm: 12, heightCm: 6 };
/** Per-unit fallback dead weight (grams) when a variant has no weight. */
export const DEFAULT_UNIT_WEIGHT_GRAMS = 500;
/** Default safety padding added to EACH dimension of the final box (cm). */
export const DEFAULT_PACKING_PADDING_CM = 2;

type Unit = { l: number; w: number; h: number };
type Placed = { x: number; y: number; z: number; l: number; w: number; h: number };

const EPS = 1e-6;

/** The (up to 6) axis-aligned orientations of a box, de-duplicated for cubes/squares. */
function orientations(u: Unit): Unit[] {
  const perms: Unit[] = [
    { l: u.l, w: u.w, h: u.h },
    { l: u.l, w: u.h, h: u.w },
    { l: u.w, w: u.l, h: u.h },
    { l: u.w, w: u.h, h: u.l },
    { l: u.h, w: u.l, h: u.w },
    { l: u.h, w: u.w, h: u.l }
  ];
  const seen = new Set<string>();
  return perms.filter((p) => {
    const k = `${p.l}x${p.w}x${p.h}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function overlaps(a: Placed, b: Placed): boolean {
  return (
    a.x < b.x + b.l - EPS &&
    a.x + a.l > b.x + EPS &&
    a.y < b.y + b.w - EPS &&
    a.y + a.w > b.y + EPS &&
    a.z < b.z + b.h - EPS &&
    a.z + a.h > b.z + EPS
  );
}

/**
 * Try to pack every unit into a container of footprint L×W with height limit Hmax.
 * Returns whether all fit and the max height actually used (for bounding-box mode,
 * call with Hmax = Infinity). Extreme-Point First-Fit-Decreasing, bottom-back-left.
 */
function packInto(
  units: Unit[],
  L: number,
  W: number,
  Hmax: number
): { fits: boolean; usedHeight: number } {
  // Largest-first improves packing quality and determinism.
  const sorted = [...units].sort((a, b) => b.l * b.w * b.h - a.l * a.w * a.h);
  const placed: Placed[] = [];
  // Candidate corner positions; seed with the back-bottom-left origin.
  let points: Array<{ x: number; y: number; z: number }> = [{ x: 0, y: 0, z: 0 }];
  let usedHeight = 0;

  for (const unit of sorted) {
    let best: Placed | null = null;
    // Prefer the lowest, then most-back, then most-left position (stable stacking).
    const candidates = [...points].sort((p, q) => p.z - q.z || p.y - q.y || p.x - q.x);
    outer: for (const pt of candidates) {
      for (const o of orientations(unit)) {
        if (pt.x + o.l > L + EPS || pt.y + o.w > W + EPS || pt.z + o.h > Hmax + EPS) continue;
        const cand: Placed = { x: pt.x, y: pt.y, z: pt.z, l: o.l, w: o.w, h: o.h };
        if (placed.some((p) => overlaps(cand, p))) continue;
        best = cand;
        break outer;
      }
    }
    if (!best) return { fits: false, usedHeight: Infinity };
    placed.push(best);
    usedHeight = Math.max(usedHeight, best.z + best.h);
    // New extreme points at the three exposed corners of the placed box.
    points = points.filter((p) => !(p.x === best!.x && p.y === best!.y && p.z === best!.z));
    points.push(
      { x: best.x + best.l, y: best.y, z: best.z },
      { x: best.x, y: best.y + best.w, z: best.z },
      { x: best.x, y: best.y, z: best.z + best.h }
    );
  }
  return { fits: true, usedHeight };
}

/** Expand line items (with quantity) into individual unit boxes, applying defaults. */
function toUnits(items: CartonItem[]): Unit[] {
  const units: Unit[] = [];
  for (const it of items) {
    const l = it.lengthCm > 0 ? it.lengthCm : DEFAULT_UNIT_BOX.lengthCm;
    const w = it.widthCm > 0 ? it.widthCm : DEFAULT_UNIT_BOX.widthCm;
    const h = it.heightCm > 0 ? it.heightCm : DEFAULT_UNIT_BOX.heightCm;
    const qty = Math.max(1, Math.floor(it.quantity));
    for (let i = 0; i < qty; i++) units.push({ l, w, h });
  }
  return units;
}

function totalWeightGrams(items: CartonItem[]): number {
  return items.reduce((sum, it) => {
    const unit = it.weightGrams && it.weightGrams > 0 ? it.weightGrams : DEFAULT_UNIT_WEIGHT_GRAMS;
    return sum + Math.max(unit, 1) * Math.max(1, Math.floor(it.quantity));
  }, 0);
}

/**
 * Compute the tightest enclosing box for a set of units by 3D-packing them onto
 * several candidate footprints and keeping the minimum-volume feasible result.
 */
function computeBoundingBox(units: Unit[]): BoxDimensions {
  if (units.length === 1) {
    const u = units[0]!;
    // Lay the single item flat: smallest dimension becomes height.
    const dims = [u.l, u.w, u.h].sort((a, b) => b - a);
    return { lengthCm: dims[0]!, widthCm: dims[1]!, heightCm: dims[2]! };
  }

  const totalVol = units.reduce((s, u) => s + u.l * u.w * u.h, 0);
  const maxDim = Math.max(...units.flatMap((u) => [u.l, u.w, u.h]));
  const maxFootprintSide = Math.max(...units.map((u) => Math.max(u.l, u.w, u.h)));

  // Candidate footprints (length × width) to try. We pack into each with unlimited
  // height and take the resulting height, then pick the smallest-volume box.
  const sideGuess = Math.ceil(Math.sqrt(totalVol / Math.max(maxDim, 1)));
  const candidateSides = new Set<number>([
    maxFootprintSide,
    Math.ceil(maxFootprintSide * 1.5),
    sideGuess,
    Math.ceil(sideGuess * 1.3),
    Math.ceil(maxDim),
    Math.ceil(maxDim * 2)
  ]);

  let best: BoxDimensions | null = null;
  for (const L of candidateSides) {
    for (const W of candidateSides) {
      if (L < maxFootprintSide && W < maxFootprintSide) continue; // at least one side must fit the longest item lying down
      const { fits, usedHeight } = packInto(units, L, W, Infinity);
      if (!fits) continue;
      const box = { lengthCm: L, widthCm: W, heightCm: Math.ceil(usedHeight) };
      const vol = box.lengthCm * box.widthCm * box.heightCm;
      if (!best || vol < best.lengthCm * best.widthCm * best.heightCm) best = box;
    }
  }

  // Guaranteed fallback: stack everything in one column (always feasible, never undersized).
  if (!best) {
    const L = Math.ceil(Math.max(...units.map((u) => u.l)));
    const W = Math.ceil(Math.max(...units.map((u) => u.w)));
    const H = Math.ceil(units.reduce((s, u) => s + u.h, 0));
    best = { lengthCm: L, widthCm: W, heightCm: H };
  }
  // Normalize so length ≥ width (cosmetic, matches courier convention).
  return best.lengthCm >= best.widthCm
    ? best
    : { lengthCm: best.widthCm, widthCm: best.lengthCm, heightCm: best.heightCm };
}

function pad(box: BoxDimensions, paddingCm: number): BoxDimensions {
  const p = Math.max(0, paddingCm);
  return {
    lengthCm: Math.ceil(box.lengthCm + p),
    widthCm: Math.ceil(box.widthCm + p),
    heightCm: Math.ceil(box.heightCm + p)
  };
}

/**
 * Main entry: compute the shipping box (dimensions + total weight) for an order.
 *
 * @param items       line items with per-unit dimensions/weight + quantity
 * @param boxPresets  optional catalog of real carton sizes (Ops config)
 * @param paddingCm   safety padding per dimension (default +2 cm)
 */
export function cartonize(input: {
  items: CartonItem[];
  boxPresets?: CartonBoxPreset[];
  paddingCm?: number;
}): CartonResult {
  const padding = input.paddingCm ?? DEFAULT_PACKING_PADDING_CM;
  const weightGrams = Math.max(1, totalWeightGrams(input.items));
  const units = toUnits(input.items);

  if (units.length === 0) {
    return { ...pad(DEFAULT_UNIT_BOX, padding), weightGrams, source: 'default-fallback' };
  }

  const presets = (input.boxPresets ?? []).filter(
    (b) => b.lengthCm > 0 && b.widthCm > 0 && b.heightCm > 0
  );

  // CATALOG mode: smallest real box (by volume) the items physically fit into.
  if (presets.length > 0) {
    const sorted = [...presets].sort(
      (a, b) => a.lengthCm * a.widthCm * a.heightCm - b.lengthCm * b.widthCm * b.heightCm
    );
    for (const box of sorted) {
      if (box.maxWeightGrams && box.maxWeightGrams > 0 && weightGrams > box.maxWeightGrams) continue;
      // Inner usable space = box minus padding on each side; items must fit inside that.
      const inner = {
        L: box.lengthCm - padding,
        W: box.widthCm - padding,
        H: box.heightCm - padding
      };
      if (inner.L <= 0 || inner.W <= 0 || inner.H <= 0) continue;
      if (packInto(units, inner.L, inner.W, inner.H).fits) {
        return {
          lengthCm: box.lengthCm,
          widthCm: box.widthCm,
          heightCm: box.heightCm,
          weightGrams,
          source: 'catalog',
          boxName: box.name
        };
      }
    }
    // No catalog box fits → fall through to a computed box (don't block the shipment).
  }

  const bounding = computeBoundingBox(units);
  return {
    ...pad(bounding, padding),
    weightGrams,
    source: units.length === 1 ? 'single-item' : 'computed'
  };
}
