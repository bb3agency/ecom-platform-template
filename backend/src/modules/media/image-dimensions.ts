/**
 * Intrinsic pixel dimensions read straight from an image's header bytes.
 *
 * Why this exists (backend-core 0.1.99): the storefront gallery timeline lays
 * photos out in justified rows that PRESERVE each photo's aspect ratio — the
 * defining trait of a phone/Google-Photos gallery, versus square-cropping every
 * tile. `next/image` also refuses to render without either explicit dimensions
 * or a pre-sized parent. Storing width/height at upload gives both: true
 * aspect ratios and zero layout shift.
 *
 * Header parsing only — no decode, no dependency (the project has no `sharp`),
 * and a few dozen bytes rather than megabytes of pixel data. Every reader is
 * bounds-checked and returns null rather than throwing, because a dimension is
 * an enhancement: an unreadable header must never block an otherwise valid
 * upload (the UI falls back to a 4:3 box).
 */

export type ImageDimensions = { width: number; height: number };

function isPlausible(width: number, height: number): boolean {
  // Guards against garbage parses (a stray 0 would divide-by-zero in layout,
  // and no real photo is 100k px wide).
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 100_000 &&
    height <= 100_000
  );
}

/** PNG: IHDR is always the first chunk; width/height are big-endian u32 at 16/20. */
function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (!isPng) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** GIF87a/89a: little-endian u16 width/height at offset 6/8. */
function readGifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) return null;
  if (buffer.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

/**
 * JPEG: walk the marker segments to the Start-Of-Frame (SOF0–SOF15, excluding
 * the non-frame DHT/JPG/DAC markers), whose payload carries height then width
 * as big-endian u16. Dimensions are NOT at a fixed offset — EXIF/ICC segments
 * of arbitrary length precede the frame — so the walk is required.
 */
function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1; // resync past padding
      continue;
    }
    const marker = buffer[offset + 1]!;
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC
    if (isSof) {
      if (offset + 9 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * WebP (RIFF container). Three sub-formats:
 *  - `VP8 ` lossy: 14-bit width/height after the 3-byte start code.
 *  - `VP8L` lossless: 14-bit each, packed into a 32-bit little-endian field.
 *  - `VP8X` extended: 24-bit canvas size minus one.
 */
function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const format = buffer.toString('ascii', 12, 16);

  if (format === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') {
    const width = 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16));
    const height = 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16));
    return { width, height };
  }
  return null;
}

/**
 * Intrinsic dimensions for PNG / JPEG / GIF / WebP, or null when the format is
 * unsupported or the header is truncated/corrupt. Never throws.
 */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  let result: ImageDimensions | null = null;
  try {
    result =
      readPngDimensions(buffer) ??
      readJpegDimensions(buffer) ??
      readGifDimensions(buffer) ??
      readWebpDimensions(buffer);
  } catch {
    return null;
  }
  if (!result || !isPlausible(result.width, result.height)) return null;
  return result;
}
