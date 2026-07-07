import { describe, it, expect } from 'vitest';
import { cartonize, type CartonItem, DEFAULT_PACKING_PADDING_CM } from './cartonize';

const A: CartonItem = { lengthCm: 41, widthCm: 35, heightCm: 8, weightGrams: 1000, quantity: 1 };

function volume(b: { lengthCm: number; widthCm: number; heightCm: number }) {
  return b.lengthCm * b.widthCm * b.heightCm;
}

describe('cartonize', () => {
  it('single item → its own dims (largest-flat) plus padding', () => {
    const r = cartonize({ items: [A] });
    // 41×35×8 laid flat = 41×35×8, +1 padding each side.
    expect(r.lengthCm).toBe(42);
    expect(r.widthCm).toBe(36);
    expect(r.heightCm).toBe(9);
    // weightGrams = items + packaging (carton/tape/void fill).
    expect(r.packagingWeightGrams).toBeGreaterThan(0);
    expect(r.weightGrams).toBe(1000 + r.packagingWeightGrams);
    expect(r.source).toBe('single-item');
  });

  it("real packing scenario: base fills floor, two items stack → exact bounding box", () => {
    // The user's verified pack (converted to cm), padding 0 to check the raw box:
    //  base 38×25×10 fills the floor; two 25×13×5 items stack on top (heights 10+5).
    const base: CartonItem = { lengthCm: 38, widthCm: 25, heightCm: 10, weightGrams: 2000, quantity: 1 };
    const top: CartonItem = { lengthCm: 25, widthCm: 13, heightCm: 5, weightGrams: 500, quantity: 2 };
    const r = cartonize({ items: [base, top], paddingCm: 0 });
    // Tight bounding box: footprint matches the base, height = 10 + 5.
    expect(r.lengthCm).toBe(38);
    expect(r.widthCm).toBe(25);
    expect(r.heightCm).toBe(15);
    expect(r.weightGrams).toBe(3000 + r.packagingWeightGrams);
    expect(r.source).toBe('computed');
  });

  it("merchant's exact pack resolves to the stacked box, not an equal-volume flat spread", () => {
    // User's real carton: 15×10×6 holds a 15×10×4 base + two 10×5×2 items stacked on top.
    // Volume is 900 either way (15×10×6 == 15×15×4), but the footprint tie-break must pick
    // the 15×10×6 stacked shape the merchant actually uses, not 15×15×4.
    const base: CartonItem = { lengthCm: 15, widthCm: 10, heightCm: 4, weightGrams: 1000, quantity: 1 };
    const top: CartonItem = { lengthCm: 10, widthCm: 5, heightCm: 2, weightGrams: 200, quantity: 2 };
    const r = cartonize({ items: [base, top], paddingCm: 0 });
    expect(r.lengthCm).toBe(15);
    expect(r.widthCm).toBe(10);
    expect(r.heightCm).toBe(6);
    expect(volume(r)).toBe(900);
  });

  it('keepUpright item is not laid flat (single item)', () => {
    // Tall bottle 10×10×30 that must stay upright: height stays 30 (not laid flat to 10).
    const bottle: CartonItem = {
      lengthCm: 10, widthCm: 10, heightCm: 30, weightGrams: 800, quantity: 1, keepUpright: true
    };
    const r = cartonize({ items: [bottle], paddingCm: 0 });
    expect(r.heightCm).toBe(30);
    expect(r.lengthCm).toBe(10);
    expect(r.widthCm).toBe(10);
    expect(r.source).toBe('single-item');
  });

  it('keepUpright forces a taller box than free rotation would', () => {
    const upright: CartonItem = {
      lengthCm: 10, widthCm: 10, heightCm: 30, weightGrams: 800, quantity: 2, keepUpright: true
    };
    const free: CartonItem = {
      lengthCm: 10, widthCm: 10, heightCm: 30, weightGrams: 800, quantity: 2
    };
    const rUpright = cartonize({ items: [upright], paddingCm: 0 });
    const rFree = cartonize({ items: [free], paddingCm: 0 });
    // Upright items can't be laid down, so the box must be at least 30 tall.
    expect(rUpright.heightCm).toBeGreaterThanOrEqual(30);
    // Free rotation can lay them flat, allowing a shorter box.
    expect(rFree.heightCm).toBeLessThanOrEqual(rUpright.heightCm);
  });

  it("two products → ONE box that physically contains both (the user's scenario)", () => {
    const B: CartonItem = { lengthCm: 20, widthCm: 15, heightCm: 10, weightGrams: 700, quantity: 1 };
    const r = cartonize({ items: [A, B] });

    // The box must be able to hold each item along some axis and have >= combined volume.
    const maxItemDim = Math.max(41, 35, 8, 20, 15, 10);
    const longestBoxSide = Math.max(r.lengthCm, r.widthCm, r.heightCm);
    expect(longestBoxSide).toBeGreaterThanOrEqual(maxItemDim); // longest item must fit

    const combinedItemVolume = 41 * 35 * 8 + 20 * 15 * 10;
    expect(volume(r)).toBeGreaterThanOrEqual(combinedItemVolume); // never undersized
    expect(r.weightGrams).toBe(1700 + r.packagingWeightGrams);
    expect(r.source).toBe('computed');
  });

  it('catalog mode: picks the smallest real box the items fit into', () => {
    const small = { name: 'S', lengthCm: 25, widthCm: 20, heightCm: 15 };
    const medium = { name: 'M', lengthCm: 50, widthCm: 40, heightCm: 20 };
    const large = { name: 'L', lengthCm: 60, widthCm: 60, heightCm: 60 };
    const r = cartonize({ items: [A], boxPresets: [large, small, medium] });
    // A (41×35×8) cannot fit in S (25×20×15); smallest that fits is M.
    expect(r.source).toBe('catalog');
    expect(r.boxName).toBe('M');
    expect(r).toMatchObject({ lengthCm: 50, widthCm: 40, heightCm: 20 });
  });

  it('catalog mode: falls back to computed box when nothing in the catalog fits', () => {
    const tiny = { name: 'T', lengthCm: 10, widthCm: 10, heightCm: 10 };
    const r = cartonize({ items: [A], boxPresets: [tiny] });
    expect(r.source).toBe('single-item');
    expect(Math.max(r.lengthCm, r.widthCm, r.heightCm)).toBeGreaterThanOrEqual(41);
  });

  it('two identical flat items stack into ~double height, not double footprint', () => {
    const flat: CartonItem = { lengthCm: 30, widthCm: 20, heightCm: 5, weightGrams: 400, quantity: 2 };
    const r = cartonize({ items: [flat] });
    // Best pack: 30×20 footprint, stacked to height ~10 (+pad). Footprint stays ~30×20.
    expect(r.lengthCm).toBeLessThanOrEqual(30 + DEFAULT_PACKING_PADDING_CM + 1);
    expect(volume(r)).toBeGreaterThanOrEqual(2 * 30 * 20 * 5);
  });

  it('missing dimensions → default unit box, never zero', () => {
    const noDims: CartonItem = { lengthCm: 0, widthCm: 0, heightCm: 0, weightGrams: 0, quantity: 1 };
    const r = cartonize({ items: [noDims] });
    expect(r.lengthCm).toBeGreaterThan(0);
    expect(r.widthCm).toBeGreaterThan(0);
    expect(r.heightCm).toBeGreaterThan(0);
    expect(r.weightGrams).toBe(500 + r.packagingWeightGrams); // default unit weight + packaging
  });

  it('respects custom padding', () => {
    const r0 = cartonize({ items: [A], paddingCm: 0 });
    expect(r0).toMatchObject({ lengthCm: 41, widthCm: 35, heightCm: 8 });
  });

  it('default padding is +1 cm per dimension', () => {
    expect(DEFAULT_PACKING_PADDING_CM).toBe(1);
  });
});
