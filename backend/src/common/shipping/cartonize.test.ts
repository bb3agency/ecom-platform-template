import { describe, it, expect } from 'vitest';
import { cartonize, type CartonItem, DEFAULT_PACKING_PADDING_CM } from './cartonize';

const A: CartonItem = { lengthCm: 41, widthCm: 35, heightCm: 8, weightGrams: 1000, quantity: 1 };

function volume(b: { lengthCm: number; widthCm: number; heightCm: number }) {
  return b.lengthCm * b.widthCm * b.heightCm;
}

describe('cartonize', () => {
  it('single item → its own dims (largest-flat) plus padding', () => {
    const r = cartonize({ items: [A] });
    // 41×35×8 laid flat = 41×35×8, +2 padding each side.
    expect(r.lengthCm).toBe(43);
    expect(r.widthCm).toBe(37);
    expect(r.heightCm).toBe(10);
    expect(r.weightGrams).toBe(1000);
    expect(r.source).toBe('single-item');
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
    expect(r.weightGrams).toBe(1700);
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
    expect(r.weightGrams).toBe(500); // default unit weight
  });

  it('respects custom padding', () => {
    const r0 = cartonize({ items: [A], paddingCm: 0 });
    expect(r0).toMatchObject({ lengthCm: 41, widthCm: 35, heightCm: 8 });
  });
});
