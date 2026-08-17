/**
 * How an order line's quantity is expressed on documents the customer sees.
 *
 * A catalogue mixes two kinds of SKU: goods sold by WEIGHT (a 500 g pack of rice —
 * the merchant and the buyer both think in kilograms) and goods sold by COUNT (a
 * bottle, a soap bar, a gift box). Printing a single "Quantity (kg)" column would
 * put a kilogram figure against a bottle, which on a tax invoice is simply false.
 * So the unit travels per row, exactly as it does on standard trade invoices.
 *
 * For a weight line the printed quantity is the TOTAL weight (2 packs × 500 g =
 * 1 kg) and the rate is therefore per kilogram, so `quantity × rate = taxable value`
 * still reconciles. For a count line nothing changes: quantity is the count and the
 * rate is per piece.
 */

/** Weight at or above which the line is expressed in kg rather than g. */
const KG_IN_GRAMS = 1000;

export interface LineQuantityInput {
  /** Number of units ordered. Always a positive integer. */
  quantity: number;
  /** Per-unit net weight in grams; null/undefined/0 means the item is not sold by weight. */
  weightGrams?: number | null | undefined;
}

export interface LineQuantityDisplay {
  /** True when the line is expressed by weight rather than by count. */
  isWeightBased: boolean;
  /** Numeric quantity in the display unit — 0.5 for a single 500 g pack. */
  value: number;
  /** `kg` for weight lines, `pcs` for count lines. */
  unit: 'kg' | 'pcs';
  /** Ready-to-print quantity, e.g. `0.5 kg` or `2 pcs`. */
  text: string;
  /**
   * Divisor for turning a line's taxable value into a printable rate. Equals the
   * total kilograms on weight lines and the unit count elsewhere, so the printed
   * rate is per-kg or per-piece to match the printed quantity.
   */
  rateDivisor: number;
  /** Suffix for the rate column, e.g. `/kg`. */
  rateSuffix: '/kg' | '';
}

/**
 * Trims trailing zeros so 0.500 prints as `0.5` and 1.000 as `1`, while keeping
 * enough precision for small weights (a 5 g sachet is 0.005 kg).
 */
function formatWeightValue(kg: number): string {
  return kg
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

export function resolveLineQuantityDisplay(input: LineQuantityInput): LineQuantityDisplay {
  const quantity = Number.isFinite(input.quantity) ? input.quantity : 0;
  const weightGrams = input.weightGrams ?? 0;

  // Guard against a corrupt/legacy weight: a non-positive or non-finite value means
  // we do not actually know the weight, and inventing one on an invoice is worse
  // than falling back to a plain count.
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
    return {
      isWeightBased: false,
      value: quantity,
      unit: 'pcs',
      text: `${quantity} pcs`,
      rateDivisor: quantity > 0 ? quantity : 1,
      rateSuffix: ''
    };
  }

  const totalKg = (weightGrams * quantity) / KG_IN_GRAMS;
  return {
    isWeightBased: true,
    value: totalKg,
    unit: 'kg',
    text: `${formatWeightValue(totalKg)} kg`,
    // Never zero: a zero-quantity line would otherwise divide by zero downstream.
    rateDivisor: totalKg > 0 ? totalKg : 1,
    rateSuffix: '/kg'
  };
}
