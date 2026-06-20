export {
  OTP_INPUT_JSON_SCHEMA as OPS_OTP_INPUT_JSON_SCHEMA,
  normalizeOtpCode as normalizeOpsOtpCode,
  parseOtpCodeInput as parseOpsOtpCodeInput
} from '@common/auth/otp-code.js';

import { normalizeOtpCode } from '@common/auth/otp-code.js';

export function assertValidOpsOtpCode(raw: string): string {
  const normalized = normalizeOtpCode(raw);
  if (normalized.length !== 6) {
    throw new Error('OTP must be exactly 6 digits');
  }
  return normalized;
}
