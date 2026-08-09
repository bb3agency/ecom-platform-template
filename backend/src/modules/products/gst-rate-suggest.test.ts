import { describe, expect, it } from 'vitest';
import { suggestGstRateForHsn } from './gst-rate-suggest';
import { GST_RATE_RULES } from './gst-rate-dataset';

describe('suggestGstRateForHsn — vendored CBIC GST 2.0 rate rules', () => {
  it('suggests 5% for ghee/butter (0405)', () => {
    const s = suggestGstRateForHsn('0405');
    expect(s?.ratePercent).toBe(5);
    expect(s?.matchedPrefix).toBe('0405');
  });

  it('longest prefix wins: paneer subheading (040610) is exempt while cheese heading (0406) is 5%', () => {
    expect(suggestGstRateForHsn('0406')?.ratePercent).toBe(5);
    const paneer = suggestGstRateForHsn('040610');
    expect(paneer?.ratePercent).toBe(0);
    expect(paneer?.matchedPrefix).toBe('040610');
  });

  it('resolves 6- and 8-digit codes through their heading rule (turmeric 09103020 → spices 5%)', () => {
    expect(suggestGstRateForHsn('09103020')?.ratePercent).toBe(5);
  });

  it('carries qualifier notes for conditional rates (rice pre-packaged vs loose)', () => {
    const rice = suggestGstRateForHsn('1006');
    expect(rice?.ratePercent).toBe(5);
    expect(rice?.note).toMatch(/loose/i);
  });

  it('knows the GST 2.0 rate cuts (shampoo 3305 and soap 3401 are 5%, not 18%)', () => {
    expect(suggestGstRateForHsn('3305')?.ratePercent).toBe(5);
    expect(suggestGstRateForHsn('3401')?.ratePercent).toBe(5);
    // …while the chapter defaults around them stay 18%.
    expect(suggestGstRateForHsn('3304')?.ratePercent).toBe(18);
    expect(suggestGstRateForHsn('3402')?.ratePercent).toBe(18);
  });

  it('flags the 40% demerit slab for aerated drinks (2202)', () => {
    expect(suggestGstRateForHsn('2202')?.ratePercent).toBe(40);
  });

  it('returns null for uncovered codes and invalid input — never guesses', () => {
    expect(suggestGstRateForHsn('9999')).toBeNull();
    expect(suggestGstRateForHsn('')).toBeNull();
    expect(suggestGstRateForHsn('abcd')).toBeNull();
    expect(suggestGstRateForHsn('4')).toBeNull();
  });

  it('dataset only contains live GST 2.0 slabs (0/3/5/18/40 — 12% and 28% are dead)', () => {
    const allowed = new Set([0, 3, 5, 18, 40]);
    for (const [prefix, rate] of GST_RATE_RULES) {
      expect(allowed.has(rate), `prefix ${prefix} carries dead slab ${rate}%`).toBe(true);
    }
  });

  it('dataset prefixes are 2-6 digit numeric strings', () => {
    for (const [prefix] of GST_RATE_RULES) {
      expect(prefix).toMatch(/^\d{2,6}$/);
    }
  });
});
