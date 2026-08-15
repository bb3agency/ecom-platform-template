import { describe, expect, it } from 'vitest';
import { readImageDimensions } from './image-dimensions';

/**
 * Header parsing is easy to get subtly wrong (endianness, bit masks, JPEG's
 * variable-length segment walk), and a wrong aspect ratio silently distorts
 * every tile in the gallery timeline. These build real headers byte by byte.
 */

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** JPEG with a leading EXIF segment, so the SOF is NOT at a fixed offset. */
function jpegHeader(width: number, height: number, marker = 0xc0): Buffer {
  const exifPayload = Buffer.alloc(40, 0x20);
  const parts: Buffer[] = [
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    (() => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(exifPayload.length + 2);
      return len;
    })(),
    exifPayload,
    Buffer.from([0xff, marker]),
    (() => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(11);
      return len;
    })(),
    Buffer.from([0x08]) // sample precision
  ];
  const dims = Buffer.alloc(4);
  dims.writeUInt16BE(height, 0);
  dims.writeUInt16BE(width, 2);
  parts.push(dims, Buffer.from([0x03, 0x01, 0x22, 0x00]));
  return Buffer.concat(parts);
}

function gifHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(13);
  buffer.write('GIF89a', 0, 'ascii');
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

function webpLossy(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8 ', 12, 'ascii');
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

function webpLossless(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8L', 12, 'ascii');
  buffer.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return buffer;
}

function webpExtended(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  const w = width - 1;
  const h = height - 1;
  buffer[24] = w & 0xff;
  buffer[25] = (w >> 8) & 0xff;
  buffer[26] = (w >> 16) & 0xff;
  buffer[27] = h & 0xff;
  buffer[28] = (h >> 8) & 0xff;
  buffer[29] = (h >> 16) & 0xff;
  return buffer;
}

describe('readImageDimensions', () => {
  it('reads PNG', () => {
    expect(readImageDimensions(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it('reads JPEG past a variable-length EXIF segment', () => {
    expect(readImageDimensions(jpegHeader(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it('reads progressive JPEG (SOF2) as well as baseline', () => {
    expect(readImageDimensions(jpegHeader(800, 600, 0xc2))).toEqual({ width: 800, height: 600 });
  });

  it('does not mistake a Huffman table (DHT, 0xC4) for a frame header', () => {
    // 0xC4 sits inside the SOF marker range but carries no dimensions; treating
    // it as a frame would return garbage.
    expect(readImageDimensions(jpegHeader(640, 480, 0xc4))).toBeNull();
  });

  it('reads GIF (little-endian, unlike PNG/JPEG)', () => {
    expect(readImageDimensions(gifHeader(320, 240))).toEqual({ width: 320, height: 240 });
  });

  it('reads all three WebP sub-formats', () => {
    expect(readImageDimensions(webpLossy(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(readImageDimensions(webpLossless(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(readImageDimensions(webpExtended(5000, 4000))).toEqual({ width: 5000, height: 4000 });
  });

  it('returns null rather than throwing on truncated, empty or unknown data', () => {
    expect(readImageDimensions(Buffer.alloc(0))).toBeNull();
    expect(readImageDimensions(pngHeader(100, 100).subarray(0, 12))).toBeNull();
    expect(readImageDimensions(Buffer.from('not an image at all'))).toBeNull();
    expect(readImageDimensions(Buffer.from([0xff, 0xd8]))).toBeNull(); // JPEG SOI only
  });

  it('rejects implausible dimensions instead of returning a zero', () => {
    // A zero would divide-by-zero in the layout maths.
    expect(readImageDimensions(pngHeader(0, 100))).toBeNull();
    expect(readImageDimensions(pngHeader(200000, 100))).toBeNull();
  });
});
