import { BoxPreset } from './select-box-preset';
import { cartonize, type CartonBoxPreset } from './cartonize';

/**
 * cm³ per kg used by Indian couriers (Delhivery, Shiprocket, Blue Dart, etc.) to convert
 * parcel volume into volumetric weight. Standard divisor across the industry.
 */
export const VOLUMETRIC_DIVISOR_CM3_PER_KG = 5000;

/**
 * Default parcel dimensions used when no box preset is selected. MUST mirror the fallback
 * dimensions sent by the Shiprocket adapter at AWB creation (`createShipment`), otherwise the
 * rate quote and the actual booking would compute different volumetric weights.
 */
export const DEFAULT_PARCEL_BOX: BoxPreset = {
  name: 'default',
  lengthCm: 15,
  widthCm: 15,
  heightCm: 10
};

/** Per-unit default dead weight (grams) when a variant has no weight configured. */
export const DEFAULT_UNIT_WEIGHT_GRAMS = 500;

/**
 * Indian couriers (Delhivery, Shiprocket's partner fleet) bill in 0.5 kg slabs:
 * chargeable weight is rounded UP to the next 500 g multiple.
 */
export const COURIER_WEIGHT_SLAB_GRAMS = 500;
/**
 * Re-weigh tolerance: when the computed weight lands within this margin below (or
 * exactly at) a slab boundary, the hub scale's re-weigh almost always tips the parcel
 * into the next slab — and the merchant eats the difference between the quoted slab
 * and the billed slab.
 */
export const SLAB_EDGE_GUARD_GRAMS = 50;

export type ChargeableWeightItem = {
  quantity: number;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  keepUpright?: boolean | null;
};

/**
 * Quote-side slab-edge guard. If the weight is within `SLAB_EDGE_GUARD_GRAMS` below
 * a 500 g slab boundary — or exactly on one — bump it just past the boundary so the
 * rate APIs quote the NEXT slab. The courier re-weighs every parcel at the hub; a
 * quote at 1980 g (2.0 kg slab) that captures at 2010 g is billed the 2.5 kg slab,
 * and the merchant silently eats the jump. Applied to QUOTES only — the manifest
 * always declares the true computed weight.
 */
export function applySlabEdgeGuard(weightGrams: number): number {
  const w = Math.max(1, Math.round(weightGrams));
  const remainder = w % COURIER_WEIGHT_SLAB_GRAMS;
  if (remainder === 0) return w + 1;
  if (remainder > COURIER_WEIGHT_SLAB_GRAMS - SLAB_EDGE_GUARD_GRAMS) {
    return w + (COURIER_WEIGHT_SLAB_GRAMS - remainder) + 1;
  }
  return w;
}

/**
 * Computes the chargeable weight (grams) a courier will bill for a cart/parcel:
 * `max(total dead weight incl. packaging, volumetric weight of the selected box)`,
 * then guarded against slab-edge re-weigh jumps (see `applySlabEdgeGuard`).
 *
 * Couriers bill on the GREATER of physical weight and volumetric weight. Quoting on dead weight
 * alone (as the rate APIs do by default) underprices bulky parcels — the quote shows a
 * cheap rate while the courier later bills on the volumetric weight derived from the box
 * dimensions the AWB sends. Computing chargeable weight here, with the SAME box-selection logic
 * the worker uses at AWB time, keeps "rate shown == rate billed" so the genuinely cheapest
 * provider wins and the customer is charged what they saw. Dead weight includes the
 * packaging (carton/tape/void-fill) weight — the hub scale weighs the sealed parcel,
 * not the bare products.
 */
export function computeChargeableWeightGrams(input: {
  items: ChargeableWeightItem[];
  boxPresets?: BoxPreset[];
  /** Flat merchant packaging-weight override from store settings (grams). */
  packagingWeightGramsOverride?: number | null;
}): number {
  if (input.items.length === 0) return 1;

  // Use the SAME cartonization engine the AWB worker uses, so the quoted box (and
  // therefore the quoted volumetric weight) equals what the courier is later billed.
  const presets: CartonBoxPreset[] = (input.boxPresets ?? []).map((b) => ({
    name: b.name,
    lengthCm: b.lengthCm,
    widthCm: b.widthCm,
    heightCm: b.heightCm,
    ...(b.boxWeightGrams != null ? { boxWeightGrams: b.boxWeightGrams } : {})
  }));
  const carton = cartonize({
    items: input.items.map((it) => ({
      lengthCm: it.lengthCm ?? 0,
      widthCm: it.widthCm ?? 0,
      heightCm: it.heightCm ?? 0,
      weightGrams: it.weightGrams ?? 0,
      quantity: it.quantity,
      keepUpright: it.keepUpright ?? false
    })),
    boxPresets: presets,
    ...(input.packagingWeightGramsOverride != null
      ? { packagingWeightGramsOverride: input.packagingWeightGramsOverride }
      : {})
  });

  const boxVolumeCm3 = carton.lengthCm * carton.widthCm * carton.heightCm;
  const volumetricWeightGrams = Math.round((boxVolumeCm3 / VOLUMETRIC_DIVISOR_CM3_PER_KG) * 1000);
  return applySlabEdgeGuard(Math.max(carton.weightGrams, volumetricWeightGrams, 1));
}
