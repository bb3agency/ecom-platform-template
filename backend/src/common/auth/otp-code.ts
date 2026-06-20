import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

/** JSON Schema fragment — accepts formatted input; normalize before hashing. */
export const OTP_INPUT_JSON_SCHEMA = {
  type: 'string',
  minLength: 6,
  maxLength: 16,
  pattern: '^[0-9\\s-]{6,16}$'
} as const;

/** Strips non-digits and caps at six characters. */
export function normalizeOtpCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export function parseOtpCodeInput(raw: string, fieldLabel = 'OTP'): string {
  const normalized = normalizeOtpCode(raw);
  if (normalized.length !== 6) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${fieldLabel} must be exactly 6 digits`, 400, {
      kind: 'validation',
      hintKey: 'otp_invalid_format'
    });
  }
  return normalized;
}
