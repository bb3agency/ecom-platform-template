/**
 * Core GST math for GST-INCLUSIVE Indian B2C pricing.
 *
 * Moved out of the invoices module (2026-08-10) because the same carve-out now
 * powers BOTH the invoice PDF and the checkout tax breakup — one implementation,
 * one rounding policy. The invariant everywhere:
 *
 *   the customer-facing price ALREADY CONTAINS the GST — tax is carved out of
 *   it, never added on top, so the grand total never changes. Base price of a
 *   ₹600 item at 5% = 600 × 100/105; at 18% = 600 × 100/118. Intra-state splits
 *   the carved tax 50/50 into CGST+SGST; inter-state books all of it as IGST.
 */

/**
 * GST split for a GST-INCLUSIVE line amount:
 *   taxable = round(amount × 100 / (100 + rate)); tax = amount − taxable.
 * Intra-state splits the tax into CGST + SGST (SGST takes the rounding remainder);
 * inter-state puts it all in IGST. rate <= 0 → whole amount taxable, zero tax.
 */
export function computeInclusiveGstSplit(
  lineTotalPaise: number,
  ratePercent: number,
  isInterState: boolean
): { taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number } {
  if (ratePercent <= 0) {
    return { taxableValuePaise: lineTotalPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  }
  const taxableValuePaise = Math.round((lineTotalPaise * 100) / (100 + ratePercent));
  const tax = lineTotalPaise - taxableValuePaise;
  if (isInterState) {
    return { taxableValuePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
  }
  const cgstPaise = Math.round(tax / 2);
  return { taxableValuePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0 };
}

/**
 * Largest-remainder apportionment of `amountPaise` across `weights`, so the parts sum
 * to EXACTLY `amountPaise` (no rounding drift). Zero total weight → everything on the
 * first part.
 */
function apportion(amountPaise: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0) return [];
  if (totalWeight <= 0) {
    return weights.map((_, index) => (index === 0 ? amountPaise : 0));
  }
  const exact = weights.map((w) => (amountPaise * w) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = amountPaise - floors.reduce((sum, value) => sum + value, 0);
  // Hand the leftover paise to the largest fractional parts first.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

export type GstTaxLineInput = {
  name: string;
  hsnCode: string;
  quantity: number;
  /**
   * Per-unit net weight in grams for goods sold by weight; null/absent for goods
   * sold by count. Carried through purely for PRESENTATION — the invoice prints a
   * weight-based line as total kilograms — and never enters the tax maths.
   */
  weightGrams?: number | null;
  unitPricePaise: number;
  lineTotalPaise: number;
  taxRatePercent: number;
};

export type GstTaxLine = GstTaxLineInput & {
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

/**
 * Build the order's GOODS tax lines, reconciling exactly with what was charged
 * for the goods:
 *
 *   Σ(row taxable + row CGST + row SGST + row IGST) === items gross − discount
 *
 * Rules (2026-08-10, merchant billing policy):
 *  1. **Delivery/shipping is NEVER taxed and is NEVER a line row.** The delivery
 *     charge is billed as an untaxed pass-through in the totals section only —
 *     it must not appear in the items table like a product. (This deliberately
 *     supersedes the earlier composite-supply treatment; confirm slab treatment
 *     with the client's CA if that ever needs to change.)
 *  2. **Order-level discount reduces the taxable consideration**, apportioned across item
 *     rows in proportion to their value (largest-remainder, exact to the paise). Rows
 *     therefore carry their NET (post-discount) amount — what was actually charged.
 *
 * Amounts remain GST-INCLUSIVE throughout: the tax is carved out of what was charged, never
 * added on top, so the grand total never changes. With GST billing off every rate is 0, so
 * this degrades to a plain itemisation with no tax.
 */
export function buildOrderGstTaxLines(input: {
  items: GstTaxLineInput[];
  discountPaise: number;
  isInterState: boolean;
}): GstTaxLine[] {
  const { items, isInterState } = input;
  const itemsGross = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  // Never discount more than the goods are worth (a coupon can't create negative value).
  const discountPaise = Math.min(Math.max(0, Math.round(input.discountPaise || 0)), itemsGross);
  const discountShares = apportion(
    discountPaise,
    items.map((item) => item.lineTotalPaise)
  );

  return items.map((item, index) => {
    const netPaise = item.lineTotalPaise - (discountShares[index] ?? 0);
    const split = computeInclusiveGstSplit(netPaise, item.taxRatePercent, isInterState);
    return {
      name: item.name,
      hsnCode: item.hsnCode,
      quantity: item.quantity,
      weightGrams: item.weightGrams ?? null,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: netPaise,
      taxRatePercent: item.taxRatePercent,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise
    };
  });
}

export type GstBreakupTotals = {
  /** Net-of-GST base across all rows (items after discount + shipping). */
  taxableAmountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

/** Aggregate a set of tax lines into checkout-summary totals. */
export function summarizeGstTaxLines(lines: GstTaxLine[]): GstBreakupTotals {
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let grossPaise = 0;
  for (const line of lines) {
    cgstPaise += line.cgstPaise;
    sgstPaise += line.sgstPaise;
    igstPaise += line.igstPaise;
    grossPaise += line.lineTotalPaise;
  }
  return {
    taxableAmountPaise: grossPaise - cgstPaise - sgstPaise - igstPaise,
    cgstPaise,
    sgstPaise,
    igstPaise
  };
}
