import { describe, expect, it } from 'vitest';
import { resolveLineQuantityDisplay } from './line-quantity';

describe('resolveLineQuantityDisplay', () => {
  it('prints a single 500 g pack as 0.5 kg', () => {
    const display = resolveLineQuantityDisplay({ quantity: 1, weightGrams: 500 });
    expect(display.text).toBe('0.5 kg');
    expect(display.value).toBe(0.5);
    expect(display.isWeightBased).toBe(true);
  });

  it('totals the weight across units — 2 × 500 g is 1 kg, not 0.5', () => {
    const display = resolveLineQuantityDisplay({ quantity: 2, weightGrams: 500 });
    expect(display.text).toBe('1 kg');
    expect(display.value).toBe(1);
  });

  it('keeps a whole kilogram free of trailing zeros', () => {
    expect(resolveLineQuantityDisplay({ quantity: 3, weightGrams: 1000 }).text).toBe('3 kg');
  });

  it('keeps precision for small weights', () => {
    // A 5 g sachet must not round away to 0 kg on an invoice.
    expect(resolveLineQuantityDisplay({ quantity: 1, weightGrams: 5 }).text).toBe('0.005 kg');
  });

  it('falls back to a plain count when the item is not sold by weight', () => {
    const display = resolveLineQuantityDisplay({ quantity: 2, weightGrams: null });
    expect(display.text).toBe('2 pcs');
    expect(display.isWeightBased).toBe(false);
    expect(display.rateSuffix).toBe('');
  });

  it('falls back to a count for corrupt or legacy weights rather than inventing one', () => {
    // Zero/negative weight means we do not know it. Printing "0 kg" against a real
    // charge on a tax document is worse than printing the unit count.
    for (const weightGrams of [0, -100, Number.NaN]) {
      const display = resolveLineQuantityDisplay({ quantity: 1, weightGrams });
      expect(display.isWeightBased).toBe(false);
      expect(display.text).toBe('1 pcs');
    }
  });

  it('rate divisor reconciles: taxable / divisor × quantity returns the taxable value', () => {
    const display = resolveLineQuantityDisplay({ quantity: 2, weightGrams: 500 });
    const taxablePaise = 119_000;
    const ratePerKg = taxablePaise / display.rateDivisor;
    expect(ratePerKg * display.value).toBeCloseTo(taxablePaise, 6);
    expect(display.rateSuffix).toBe('/kg');
  });

  it('never divides by zero on a zero-quantity line', () => {
    expect(resolveLineQuantityDisplay({ quantity: 0, weightGrams: 500 }).rateDivisor).toBe(1);
    expect(resolveLineQuantityDisplay({ quantity: 0, weightGrams: null }).rateDivisor).toBe(1);
  });
});
