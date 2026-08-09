import { describe, expect, it } from 'vitest';
import { suggestHsnCodes } from './hsn-suggest';

describe('suggestHsnCodes', () => {
  it('matches spice products by keyword', () => {
    const results = suggestHsnCodes('pepper crushed');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.code.startsWith('0904'))).toBe(true);
  });

  it('digit queries match codes by prefix', () => {
    const results = suggestHsnCodes('0904');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.code.startsWith('0904'))).toBe(true);
  });

  it('resolves Indian trade terms + strips pack sizes from product-name queries', () => {
    // Typical product name pasted straight from the editor. "ghee" never appears in the
    // WCO wording — the Indian-terms alias map resolves it to heading 0405 (dairy fats).
    const results = suggestHsnCodes('Organic Ghee pack 500gms');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.code.startsWith('0405'))).toBe(true);
  });

  it('resolves Telugu/Hindi product names via aliases (Sambar Kaaram → chilli 0904)', () => {
    const results = suggestHsnCodes('Sambar Kaaram');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.code.startsWith('0904'))).toBe(true);
  });

  it('returns [] for queries that are too short or entirely generic', () => {
    expect(suggestHsnCodes('a')).toEqual([]);
    expect(suggestHsnCodes('pack of the')).toEqual([]);
  });

  it('caps results at the limit and prefers 6-digit subheadings', () => {
    const results = suggestHsnCodes('rice', 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results[0]!.code).toHaveLength(6);
  });

  it('handles plural product names via singularization (Laddus → sweets 2106)', () => {
    const results = suggestHsnCodes('Laddus');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.code.startsWith('2106'))).toBe(true);
  });

  it('prefix-matches alias keys while the admin is still typing (cardam → cardamom 0908)', () => {
    const results = suggestHsnCodes('cardam');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.code.startsWith('0908'))).toBe(true);
  });

  it('does not prefix-match aliases inside multi-token queries (avoids noise)', () => {
    // "card holder gift" — "card" must not resolve to cardamom in a multi-token query.
    const results = suggestHsnCodes('card holder gift');
    expect(results.every((r) => !r.code.startsWith('0908'))).toBe(true);
  });

  it('resolves newly-added regional terms (avakaya → pickles 2001, chakli → 1905)', () => {
    expect(suggestHsnCodes('Avakaya').every((r) => r.code.startsWith('2001'))).toBe(true);
    expect(suggestHsnCodes('Chakli').some((r) => r.code.startsWith('1905'))).toBe(true);
  });

  it('resolves personal-care terms (toothpaste → 3306, detergent → 3402)', () => {
    expect(suggestHsnCodes('Herbal Toothpaste').some((r) => r.code.startsWith('3306'))).toBe(true);
    expect(suggestHsnCodes('detergent').some((r) => r.code.startsWith('3402'))).toBe(true);
  });
});
