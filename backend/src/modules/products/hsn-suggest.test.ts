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
});
