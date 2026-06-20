import { describe, it, expect } from 'vitest';
import { parseBoxPresets, selectBestFitBox, type BoxPreset } from './select-box-preset';

const SMALL: BoxPreset = { name: 'Small', lengthCm: 15, widthCm: 15, heightCm: 10 };   // 2250 cm³
const MEDIUM: BoxPreset = { name: 'Medium', lengthCm: 20, widthCm: 20, heightCm: 15 }; // 6000 cm³
const LARGE: BoxPreset = { name: 'Large', lengthCm: 30, widthCm: 25, heightCm: 20 };   // 15000 cm³

describe('parseBoxPresets', () => {
  it('returns empty array for non-array input', () => {
    expect(parseBoxPresets(null)).toEqual([]);
    expect(parseBoxPresets(undefined)).toEqual([]);
    expect(parseBoxPresets({})).toEqual([]);
    expect(parseBoxPresets('bad')).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(parseBoxPresets([])).toEqual([]);
  });

  it('parses valid presets', () => {
    const raw = [
      { name: 'Small', lengthCm: 15, widthCm: 15, heightCm: 10 },
      { name: 'Medium', lengthCm: 20, widthCm: 20, heightCm: 15 }
    ];
    expect(parseBoxPresets(raw)).toEqual(raw);
  });

  it('drops invalid entries silently', () => {
    const raw = [
      { name: 'Good', lengthCm: 15, widthCm: 15, heightCm: 10 },
      { name: 'Missing height', lengthCm: 15, widthCm: 15 },
      { name: 'Zero dim', lengthCm: 0, widthCm: 15, heightCm: 10 },
      null,
      'string',
      42
    ];
    expect(parseBoxPresets(raw)).toEqual([
      { name: 'Good', lengthCm: 15, widthCm: 15, heightCm: 10 }
    ]);
  });
});

describe('selectBestFitBox', () => {
  it('returns null for empty presets', () => {
    expect(selectBestFitBox(1000, [])).toBeNull();
  });

  it('selects the smallest box that fits', () => {
    const presets = [LARGE, SMALL, MEDIUM]; // intentionally unsorted
    // 1 unit Small product: 2250 cm³ → Small box fits exactly
    expect(selectBestFitBox(2250, presets)).toEqual(SMALL);
  });

  it('selects next size up when small box is too small', () => {
    const presets = [SMALL, MEDIUM, LARGE];
    // just over Small capacity
    expect(selectBestFitBox(2251, presets)).toEqual(MEDIUM);
  });

  it('falls back to largest box when nothing fits', () => {
    const presets = [SMALL, MEDIUM, LARGE];
    expect(selectBestFitBox(99999, presets)).toEqual(LARGE);
  });

  it('works with a single preset regardless of volume', () => {
    expect(selectBestFitBox(1, [SMALL])).toEqual(SMALL);
    expect(selectBestFitBox(99999, [SMALL])).toEqual(SMALL);
  });

  it('returns smallest box when volume is zero', () => {
    const presets = [SMALL, MEDIUM, LARGE];
    expect(selectBestFitBox(0, presets)).toEqual(SMALL);
  });
});
