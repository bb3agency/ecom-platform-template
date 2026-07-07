export type BoxPreset = {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Weight of the empty carton + packing material (grams), weighed by the merchant. */
  boxWeightGrams?: number;
};

/**
 * Parses and validates a raw JSON value from the database into a typed BoxPreset array.
 * Invalid or missing entries are silently dropped. An invalid `boxWeightGrams` is
 * dropped from the preset (falls back to estimate) rather than dropping the preset.
 */
export function parseBoxPresets(raw: unknown): BoxPreset[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).name === 'string' &&
      typeof (item as Record<string, unknown>).lengthCm === 'number' &&
      ((item as Record<string, unknown>).lengthCm as number) > 0 &&
      typeof (item as Record<string, unknown>).widthCm === 'number' &&
      ((item as Record<string, unknown>).widthCm as number) > 0 &&
      typeof (item as Record<string, unknown>).heightCm === 'number' &&
      ((item as Record<string, unknown>).heightCm as number) > 0
  );
  return valid.map((item) => {
    const boxWeightGrams = item.boxWeightGrams;
    return {
      name: item.name as string,
      lengthCm: item.lengthCm as number,
      widthCm: item.widthCm as number,
      heightCm: item.heightCm as number,
      ...(typeof boxWeightGrams === 'number' && Number.isFinite(boxWeightGrams) && boxWeightGrams > 0
        ? { boxWeightGrams: Math.round(boxWeightGrams) }
        : {})
    };
  });
}

// NOTE: the old volume-only `selectBestFitBox` was removed in backend-core 0.1.11 —
// box selection now goes through the 3D cartonization engine (`cartonize.ts`), which
// checks real geometric fit, not just total volume. `parseBoxPresets` + the `BoxPreset`
// type remain the shared helpers for reading the admin box catalog (storeSettings.boxPresets).
