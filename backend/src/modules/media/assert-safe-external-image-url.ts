import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Blocks SSRF targets before server-side fetch of external image URLs. */
export function assertSafeExternalImageFetchUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid image URL', 400);
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'External image URL must use https://', 400);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0'
  ) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Image URL host is not allowed', 400);
  }

  if (isPrivateIpv4(host)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Image URL host is not allowed', 400);
  }
}
