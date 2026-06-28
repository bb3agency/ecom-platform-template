export type BoxPreset = {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

/**
 * Parses and validates a raw JSON value from the database into a typed BoxPreset array.
 * Invalid or missing entries are silently dropped.
 */
export function parseBoxPresets(raw: unknown): BoxPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is BoxPreset =>
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
}

// NOTE: the old volume-only `selectBestFitBox` was removed in backend-core 0.1.11 —
// box selection now goes through the 3D cartonization engine (`cartonize.ts`), which
// checks real geometric fit, not just total volume. `parseBoxPresets` + the `BoxPreset`
// type remain the shared helpers for reading the admin box catalog (storeSettings.boxPresets).
