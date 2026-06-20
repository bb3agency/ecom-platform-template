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

/**
 * Selects the smallest box preset whose volume is >= totalVolumeCm3.
 * Falls back to the largest preset if none fits, so shipments are never blocked.
 * Returns null when no presets are configured.
 */
export function selectBestFitBox(
  totalVolumeCm3: number,
  presets: BoxPreset[]
): BoxPreset | null {
  if (presets.length === 0) return null;
  const sorted = [...presets].sort(
    (a, b) =>
      a.lengthCm * a.widthCm * a.heightCm - b.lengthCm * b.widthCm * b.heightCm
  );
  return (
    sorted.find((p) => p.lengthCm * p.widthCm * p.heightCm >= totalVolumeCm3) ??
    sorted[sorted.length - 1] ??
    null
  );
}
