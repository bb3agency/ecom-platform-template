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
 * In both modes a safety padding (default +1 cm/side) is added for void-fill +
 * carton walls so the parcel is never undersized.
 *
 * The packer is a conservative Extreme-Point First-Fit-Decreasing heuristic: when
 * uncertain it errs toward a LARGER box, never a smaller one — so the billed box is
 * never undersized. Exact 3D bin packing is NP-hard; this is accurate and fast for
 * the small line-item counts of real e-commerce orders.
 *
 * Items flagged `keepUpright` (fragile / "this side up" / liquids) are only rotated
 * about their vertical axis — their configured height stays the height — so the
 * computed box reflects how the parcel will really be packed.
 */

export type CartonItem = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
  quantity: number;
  /** If true, the item must stay upright — only length/width rotation is allowed. */
  keepUpright?: boolean;
};

export type BoxDimensions = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type CartonBoxPreset = BoxDimensions & {
  name: string;
  maxWeightGrams?: number;
  /**
   * Weight of the EMPTY carton + its packing material (grams), as weighed by the
   * merchant. When set, it is used verbatim instead of the surface-area estimate —
   * the most accurate way to make quoted weight match the courier's scale.
   */
  boxWeightGrams?: number;
};

export type CartonResult = BoxDimensions & {
  /** TOTAL parcel weight (grams): item dead weight + packaging weight. */
  weightGrams: number;
  /** The packaging (carton + tape + void fill) portion of weightGrams. */
  packagingWeightGrams: number;
  /** How the box was decided — for diagnostics/audit. */
  source: 'catalog' | 'computed' | 'single-item' | 'default-fallback';
  boxName?: string;
};

/** Per-unit fallback box when a variant has no dimensions configured (cm). */
export const DEFAULT_UNIT_BOX: BoxDimensions = { lengthCm: 15, widthCm: 12, heightCm: 6 };
/** Per-unit fallback dead weight (grams) when a variant has no weight. */
export const DEFAULT_UNIT_WEIGHT_GRAMS = 500;
/** Default safety padding added to EACH dimension of the final box (cm). */
export const DEFAULT_PACKING_PADDING_CM = 1;

/**
 * Corrugated-board areal density used to estimate an empty carton's weight from its
 * surface area (g/cm²). 3-ply corrugated board runs ~400–600 g/m² (0.04–0.06 g/cm²);
 * 0.055 sits at the realistic upper-middle so the estimate errs slightly heavy —
 * an underestimate is what gets the merchant re-billed a higher slab at the hub.
 */
export const CARTON_BOARD_G_PER_CM2 = 0.055;
/** Flat allowance for tape, label pouch and void-fill material (grams). */
export const PACKING_MATERIAL_ALLOWANCE_GRAMS = 40;

/**
 * Estimates the packaging weight (empty carton + tape/void fill) for a box from its
 * outer surface area: 2(LW + LH + WH) × board density + a flat material allowance.
 * Calibration: a 24×21×9 cm carton → 1818 cm² → ~100 g board + 40 g allowance = 140 g,
 * matching hub-captured weight deltas observed in production. Used whenever neither a
 * per-preset `boxWeightGrams` nor a merchant packaging-weight override is configured.
 */
export function estimatePackagingWeightGrams(box: BoxDimensions): number {
  const surfaceAreaCm2 =
    2 * (box.lengthCm * box.widthCm + box.lengthCm * box.heightCm + box.widthCm * box.heightCm);
  return Math.max(1, Math.round(surfaceAreaCm2 * CARTON_BOARD_G_PER_CM2 + PACKING_MATERIAL_ALLOWANCE_GRAMS));
}

type Unit = { l: number; w: number; h: number; keepUpright?: boolean };
type Placed = { x: number; y: number; z: number; l: number; w: number; h: number };

const EPS = 1e-6;

/**
 * The axis-aligned orientations of a box, de-duplicated for cubes/squares.
 * Upright items keep their height fixed (only length/width swap → up to 2);
 * free items use all 6 permutations.
 */
function orientations(u: Unit): Unit[] {
  const perms: Unit[] = u.keepUpright
    ? [
        { l: u.l, w: u.w, h: u.h },
        { l: u.w, w: u.l, h: u.h }
      ]
    : [
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
    for (let i = 0; i < qty; i++) units.push({ l, w, h, keepUpright: it.keepUpright === true });
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
 * Re-orient an item to its stable "flat" resting orientation — the way it would
 * actually sit in a carton: largest face down, smallest dimension vertical. Upright
 * items keep their configured orientation. The returned unit is marked keepUpright
 * so the packer never tips it onto an end (which would produce an unrealistic, and
 * dangerously UNDER-sized, thin-column box that the merchant would never ship).
 */
function stableFlat(u: Unit): Unit {
  if (u.keepUpright) return { l: u.l, w: u.w, h: u.h, keepUpright: true };
  const [a, b, c] = [u.l, u.w, u.h].sort((x, y) => y - x);
  return { l: a!, w: b!, h: c!, keepUpright: true };
}

/**
 * Compute the tightest enclosing box for a set of units by 3D-packing them onto
 * several candidate footprints and keeping the minimum-volume feasible result.
 * Items are packed in their stable flat orientation (heaviest/largest face down,
 * stacked upward) — matching how parcels are really packed — so the billed box is
 * realistic and never under-sized.
 */
function computeBoundingBox(rawUnits: Unit[]): BoxDimensions {
  // Lock every item to its stable flat orientation before packing.
  const units = rawUnits.map(stableFlat);

  if (units.length === 1) {
    const u = units[0]!;
    // Footprint is the two larger dims (length ≥ width); height is fixed.
    const [a, b] = [u.l, u.w].sort((x, y) => y - x);
    return { lengthCm: a!, widthCm: b!, heightCm: u.h };
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
  // Seed the actual item dimensions as candidate footprint sides so a tight box
  // matching the largest item (e.g. its base) is tried — yields the exact bounding
  // box for "big item fills the floor, small items stack on top" packs.
  for (const u of units) {
    candidateSides.add(Math.ceil(u.l));
    candidateSides.add(Math.ceil(u.w));
    candidateSides.add(Math.ceil(u.h));
  }

  // Selection: minimum volume, then SMALLEST FOOTPRINT, then smallest longest side.
  // The footprint tie-break is what makes equal-volume packs resolve to the realistic
  // "stack on the base" box (e.g. 15×10×6) instead of an equal-volume but spread-out
  // shape (e.g. 15×15×4) the merchant would never use — important because this box is
  // shown to the merchant as the carton to pack into.
  let best: BoxDimensions | null = null;
  let bestVol = Infinity;
  let bestFootprint = Infinity;
  let bestMaxSide = Infinity;
  for (const L of candidateSides) {
    for (const W of candidateSides) {
      // packInto is the source of truth for feasibility (it respects per-item
      // keepUpright), so we try every candidate footprint and keep the best
      // that actually packs — no blunt size pre-filter that could skip the tight box.
      const { fits, usedHeight } = packInto(units, L, W, Infinity);
      if (!fits) continue;
      const box = { lengthCm: L, widthCm: W, heightCm: Math.ceil(usedHeight) };
      const vol = box.lengthCm * box.widthCm * box.heightCm;
      const footprint = box.lengthCm * box.widthCm;
      const maxSide = Math.max(box.lengthCm, box.widthCm, box.heightCm);
      const better =
        !best ||
        vol < bestVol ||
        (vol === bestVol && footprint < bestFootprint) ||
        (vol === bestVol && footprint === bestFootprint && maxSide < bestMaxSide);
      if (better) {
        best = box;
        bestVol = vol;
        bestFootprint = footprint;
        bestMaxSide = maxSide;
      }
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
 * The returned `weightGrams` is the FULL parcel weight — item dead weight PLUS
 * packaging weight (carton + tape + void fill). Couriers weigh the sealed parcel at
 * the hub, so quoting/booking on item weight alone under-declares by the packaging
 * weight and gets re-billed a higher slab whenever the parcel sits near a boundary.
 * Packaging weight resolution order:
 *   1. the chosen catalog preset's `boxWeightGrams` (merchant weighed the carton),
 *   2. `packagingWeightGramsOverride` (flat store-level merchant override),
 *   3. surface-area estimate (`estimatePackagingWeightGrams`).
 *
 * @param items                         line items with per-unit dimensions/weight + quantity
 * @param boxPresets                    optional catalog of real carton sizes (Ops config)
 * @param paddingCm                     safety padding per dimension (default +1 cm)
 * @param packagingWeightGramsOverride  flat packaging weight from store settings (grams)
 */
export function cartonize(input: {
  items: CartonItem[];
  boxPresets?: CartonBoxPreset[];
  paddingCm?: number;
  packagingWeightGramsOverride?: number | null;
}): CartonResult {
  const padding = input.paddingCm ?? DEFAULT_PACKING_PADDING_CM;
  const itemsWeightGrams = Math.max(1, totalWeightGrams(input.items));
  const override =
    input.packagingWeightGramsOverride != null && input.packagingWeightGramsOverride > 0
      ? Math.round(input.packagingWeightGramsOverride)
      : null;
  const resolvePackaging = (box: BoxDimensions, presetBoxWeightGrams?: number): number => {
    if (presetBoxWeightGrams != null && presetBoxWeightGrams > 0) return Math.round(presetBoxWeightGrams);
    if (override != null) return override;
    return estimatePackagingWeightGrams(box);
  };
  const units = toUnits(input.items);

  if (units.length === 0) {
    const box = pad(DEFAULT_UNIT_BOX, padding);
    const packagingWeightGrams = resolvePackaging(box);
    return {
      ...box,
      weightGrams: itemsWeightGrams + packagingWeightGrams,
      packagingWeightGrams,
      source: 'default-fallback'
    };
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
      // maxWeightGrams is the carton's rated CONTENT capacity — compare against items only.
      if (box.maxWeightGrams && box.maxWeightGrams > 0 && itemsWeightGrams > box.maxWeightGrams) continue;
      // Inner usable space = box minus padding on each side; items must fit inside that.
      const inner = {
        L: box.lengthCm - padding,
        W: box.widthCm - padding,
        H: box.heightCm - padding
      };
      if (inner.L <= 0 || inner.W <= 0 || inner.H <= 0) continue;
      if (packInto(units, inner.L, inner.W, inner.H).fits) {
        const packagingWeightGrams = resolvePackaging(box, box.boxWeightGrams);
        return {
          lengthCm: box.lengthCm,
          widthCm: box.widthCm,
          heightCm: box.heightCm,
          weightGrams: itemsWeightGrams + packagingWeightGrams,
          packagingWeightGrams,
          source: 'catalog',
          boxName: box.name
        };
      }
    }
    // No catalog box fits → fall through to a computed box (don't block the shipment).
  }

  const bounding = pad(computeBoundingBox(units), padding);
  const packagingWeightGrams = resolvePackaging(bounding);
  return {
    ...bounding,
    weightGrams: itemsWeightGrams + packagingWeightGrams,
    packagingWeightGrams,
    source: units.length === 1 ? 'single-item' : 'computed'
  };
}
