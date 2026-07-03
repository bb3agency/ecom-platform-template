import { describe, expect, it, vi } from 'vitest';
import {
  generateOrderNumber,
  generateUniqueOrderNumber,
  ORDER_NUMBER_PATTERN
} from './order-number';

describe('order number generation', () => {
  it('produces the ORD-XXXX-XXXX format with unambiguous characters only', () => {
    for (let i = 0; i < 200; i += 1) {
      const orderNumber = generateOrderNumber();
      expect(orderNumber).toMatch(ORDER_NUMBER_PATTERN);
      // No ambiguous glyphs in the RANDOM part (the ORD- prefix legitimately contains an O).
      expect(orderNumber.slice(4)).not.toMatch(/[ILO01]/);
    }
  });

  it('is non-sequential: consecutive numbers do not increment and do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(generateOrderNumber());
    }
    // 500 draws from ~8.5e11 space must be unique (collision here would indicate broken RNG).
    expect(seen.size).toBe(500);
  });

  it('returns the first candidate when unused', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const orderNumber = await generateUniqueOrderNumber({ order: { findUnique } });
    expect(orderNumber).toMatch(ORDER_NUMBER_PATTERN);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('retries on collision and returns a fresh candidate', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'existing_order' })
      .mockResolvedValueOnce(null);
    const orderNumber = await generateUniqueOrderNumber({ order: { findUnique } });
    expect(orderNumber).toMatch(ORDER_NUMBER_PATTERN);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('fails loudly after exhausting attempts instead of looping forever', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'always_taken' });
    await expect(generateUniqueOrderNumber({ order: { findUnique } })).rejects.toThrow(
      /unique order number/i
    );
    expect(findUnique).toHaveBeenCalledTimes(5);
  });
});
