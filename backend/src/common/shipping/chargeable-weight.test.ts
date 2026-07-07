import { describe, expect, it } from 'vitest';
import { applySlabEdgeGuard, computeChargeableWeightGrams } from './chargeable-weight';
import { estimatePackagingWeightGrams } from './cartonize';

// Chargeable weight now includes the PACKAGING weight (carton + tape + void fill):
// the courier's hub scale weighs the sealed parcel, not the bare products. Without
// it, every parcel near a 500g slab boundary was re-billed a higher slab (observed
// in production: 2000g quoted, 2140g captured → next slab, merchant ate ₹42).
describe('computeChargeableWeightGrams', () => {
  it('uses dead weight (incl. packaging) when it exceeds volumetric weight', () => {
    // 2kg dead, tiny 5×5×5 item → padded box 6×6×6 → estimated packaging 52g.
    // dead = 2000 + 52 = 2052; volumetric = 216cm³ → 43g. Dead wins; 2052 is not
    // near a slab edge (2052 % 500 = 52) so no guard applies.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 1, weightGrams: 2000, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    expect(result).toBe(2052);
  });

  it('uses volumetric weight when the selected box is bulky-but-light (the ₹130→₹480 bug)', () => {
    // 200g dead weight, but the merchant ships in a large 50×40×25cm box preset →
    // volumetric = 50*40*25/5000*1000 = 10000g. This is what Shiprocket bills at AWB,
    // so the quote must reflect it too (instead of the cheap 200g dead-weight rate).
    // 10000 sits EXACTLY on a slab boundary → the slab-edge guard bumps it past
    // (a hub re-weigh of a 10.0kg-declared parcel almost always captures 10.0+).
    const result = computeChargeableWeightGrams({
      boxPresets: [{ name: 'large', lengthCm: 50, widthCm: 40, heightCm: 25 }],
      items: [{ quantity: 1, weightGrams: 200, lengthCm: 30, widthCm: 25, heightCm: 15 }]
    });
    expect(result).toBe(10001);
  });

  it('selects the best-fit box preset when dimensions are present', () => {
    // Item volume 30*20*10 = 6000cm³ → smallest preset >= 6000 is the 40×30×20 box (24000cm³).
    const result = computeChargeableWeightGrams({
      boxPresets: [
        { name: 'small', lengthCm: 20, widthCm: 15, heightCm: 10 }, // 3000cm³ (too small)
        { name: 'medium', lengthCm: 40, widthCm: 30, heightCm: 20 } // 24000cm³
      ],
      items: [{ quantity: 1, weightGrams: 100, lengthCm: 30, widthCm: 20, heightCm: 10 }]
    });
    // volumetric = 24000/5000*1000 = 4800g, dead (100g + packaging) is far below → 4800g.
    expect(result).toBe(4800);
  });

  it('falls back to the default per-unit box (cartonized) when no dimensions and no presets', () => {
    // No item dims → cartonize uses the default unit box 15×12×6 +1cm padding = 16×13×7.
    // packaging estimate for 16×13×7 = 85g; dead = 300 + 85 = 385g; volumetric 291g → 385g.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 1, weightGrams: 300 }]
    });
    expect(result).toBe(385);
  });

  it('multiplies dead weight by quantity', () => {
    // 3 × 1000g cubes (5×5×5) stack into a 5×5×15 column → padded 6×6×16 → packaging 65g.
    // dead = 3000 + 65 = 3065; volumetric 115g → 3065.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 3, weightGrams: 1000, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    expect(result).toBe(3065);
  });

  it('uses the default unit weight when a variant has no weight', () => {
    // No weight → dead falls back to 500g + 52g packaging (6×6×6 box) = 552g.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 1, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    expect(result).toBe(552);
  });

  it('uses the preset boxWeightGrams verbatim when the merchant weighed the carton', () => {
    const withEstimate = computeChargeableWeightGrams({
      boxPresets: [{ name: 'M', lengthCm: 20, widthCm: 15, heightCm: 10 }],
      items: [{ quantity: 1, weightGrams: 2000, lengthCm: 10, widthCm: 10, heightCm: 5 }]
    });
    const withWeighedBox = computeChargeableWeightGrams({
      boxPresets: [{ name: 'M', lengthCm: 20, widthCm: 15, heightCm: 10, boxWeightGrams: 120 }],
      items: [{ quantity: 1, weightGrams: 2000, lengthCm: 10, widthCm: 10, heightCm: 5 }]
    });
    // 20×15×10 estimate = 2(300+200+150)=1300cm² → 112g → 2000+112 = 2112.
    expect(withEstimate).toBe(2112);
    // Weighed carton: 2000 + 120 = 2120.
    expect(withWeighedBox).toBe(2120);
  });

  it('applies the flat store packaging-weight override when no preset weight exists', () => {
    const result = computeChargeableWeightGrams({
      packagingWeightGramsOverride: 200,
      items: [{ quantity: 1, weightGrams: 2000, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    // dead = 2000 + 200 override = 2200 (volumetric negligible), no slab edge.
    expect(result).toBe(2200);
  });
});

describe('estimatePackagingWeightGrams', () => {
  it('calibrates to the production-observed 140g for a 24×21×9 carton', () => {
    // Real incident: 2×1kg products quoted at 2000g; Delhivery hub captured 2140g.
    // The 140g gap was the carton + packing material of the computed 24×21×9 box.
    expect(estimatePackagingWeightGrams({ lengthCm: 24, widthCm: 21, heightCm: 9 })).toBe(140);
  });
});

describe('applySlabEdgeGuard', () => {
  it('bumps weights within 50g below a 500g boundary past the boundary', () => {
    expect(applySlabEdgeGuard(1980)).toBe(2001); // 2.0kg slab quote would re-bill as 2.5kg
    expect(applySlabEdgeGuard(451)).toBe(501);
  });

  it('bumps exact slab boundaries past the boundary', () => {
    expect(applySlabEdgeGuard(2000)).toBe(2001);
    expect(applySlabEdgeGuard(500)).toBe(501);
  });

  it('leaves safely-inside-slab weights untouched', () => {
    expect(applySlabEdgeGuard(2140)).toBe(2140);
    expect(applySlabEdgeGuard(2051)).toBe(2051);
    expect(applySlabEdgeGuard(300)).toBe(300);
  });
});
