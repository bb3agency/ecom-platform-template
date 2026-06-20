import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

/**
 * Validates that a setupBaseUrl is safe to use as an invite link origin.
 * Rejects non-HTTPS URLs and RFC-1918 / link-local / loopback hostnames to
 * prevent SSRF vectors from a malicious operator.
 */
export function validateSetupBaseUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'setupBaseUrl is not a valid URL', 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'setupBaseUrl must use HTTPS', 400);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'setupBaseUrl hostname is not permitted', 400);
  }
  if (/^169\.254\./.test(hostname)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'setupBaseUrl hostname is not permitted', 400);
  }
  if (
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^192\.168\./.test(hostname)
  ) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'setupBaseUrl hostname is not permitted', 400);
  }
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'setupBaseUrl hostname is not permitted', 400);
  }
}
