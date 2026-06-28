import { describe, it, expect } from 'vitest';
import { parseBoxPresets } from './select-box-preset';

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

// Box SELECTION is now covered by cartonize.test.ts (3D fit), which replaced the
// removed volume-only selectBestFitBox.
