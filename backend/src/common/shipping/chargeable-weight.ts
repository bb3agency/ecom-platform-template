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

export type ChargeableWeightItem = {
  quantity: number;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

/**
 * Computes the chargeable weight (grams) a courier will bill for a cart/parcel:
 * `max(total dead weight, volumetric weight of the selected box)`.
 *
 * Couriers bill on the GREATER of physical weight and volumetric weight. Quoting on dead weight
 * alone (as the rate APIs do by default) underprices bulky-but-light parcels — the quote shows a
 * cheap rate while the courier later bills on the volumetric weight derived from the box
 * dimensions the AWB sends. Computing chargeable weight here, with the SAME box-selection logic
 * the worker uses at AWB time, keeps "rate shown == rate billed" so the genuinely cheapest
 * provider wins and the customer is charged what they saw.
 */
export function computeChargeableWeightGrams(input: {
  items: ChargeableWeightItem[];
  boxPresets?: BoxPreset[];
}): number {
  if (input.items.length === 0) return 1;

  // Use the SAME cartonization engine the AWB worker uses, so the quoted box (and
  // therefore the quoted volumetric weight) equals what the courier is later billed.
  const presets: CartonBoxPreset[] = (input.boxPresets ?? []).map((b) => ({
    name: b.name,
    lengthCm: b.lengthCm,
    widthCm: b.widthCm,
    heightCm: b.heightCm
  }));
  const carton = cartonize({
    items: input.items.map((it) => ({
      lengthCm: it.lengthCm ?? 0,
      widthCm: it.widthCm ?? 0,
      heightCm: it.heightCm ?? 0,
      weightGrams: it.weightGrams ?? 0,
      quantity: it.quantity
    })),
    boxPresets: presets
  });

  const boxVolumeCm3 = carton.lengthCm * carton.widthCm * carton.heightCm;
  const volumetricWeightGrams = Math.round((boxVolumeCm3 / VOLUMETRIC_DIVISOR_CM3_PER_KG) * 1000);
  return Math.max(carton.weightGrams, volumetricWeightGrams, 1);
}
