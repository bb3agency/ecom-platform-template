import { describe, expect, it } from 'vitest';
import { computeChargeableWeightGrams } from './chargeable-weight';

describe('computeChargeableWeightGrams', () => {
  it('uses dead weight when it exceeds volumetric weight', () => {
    // 2kg dead, tiny box → dead weight wins.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 1, weightGrams: 2000, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    expect(result).toBe(2000);
  });

  it('uses volumetric weight when the selected box is bulky-but-light (the ₹130→₹480 bug)', () => {
    // 200g dead weight, but the merchant ships in a large 50×40×25cm box preset →
    // volumetric = 50*40*25/5000*1000 = 10000g. This is what Shiprocket bills at AWB,
    // so the quote must reflect it too (instead of the cheap 200g dead-weight rate).
    const result = computeChargeableWeightGrams({
      boxPresets: [{ name: 'large', lengthCm: 50, widthCm: 40, heightCm: 25 }],
      items: [{ quantity: 1, weightGrams: 200, lengthCm: 30, widthCm: 25, heightCm: 15 }]
    });
    expect(result).toBe(10000);
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
    // volumetric = 24000/5000*1000 = 4800g, dead = 100g → 4800g.
    expect(result).toBe(4800);
  });

  it('falls back to the default per-unit box (cartonized) when no dimensions and no presets', () => {
    // No item dims → cartonize uses the default unit box 15×12×6 +2cm padding = 17×14×8.
    // dead = 300g; volumetric = 17*14*8/5000*1000 = 381g → 381g wins.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 1, weightGrams: 300 }]
    });
    expect(result).toBe(381);
  });

  it('multiplies dead weight by quantity', () => {
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 3, weightGrams: 1000, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    expect(result).toBe(3000);
  });

  it('uses the default unit weight when a variant has no weight', () => {
    // No weight, tiny dims → dead falls back to 500g; default box volumetric 450g → 500g wins.
    const result = computeChargeableWeightGrams({
      items: [{ quantity: 1, lengthCm: 5, widthCm: 5, heightCm: 5 }]
    });
    expect(result).toBe(500);
  });
});
