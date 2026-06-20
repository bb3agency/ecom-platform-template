import { describe, expect, it } from 'vitest';
import { AppError } from '@common/errors/app-error';
import { assertValidOpsOtpCode, normalizeOpsOtpCode, parseOpsOtpCodeInput } from './ops-otp-code.js';

describe('ops-otp-code', () => {
  it('strips non-digit separators from OTP input', () => {
    expect(normalizeOpsOtpCode('5 2 1 6 7 6')).toBe('521676');
    expect(normalizeOpsOtpCode('521-676')).toBe('521676');
  });

  it('assertValidOpsOtpCode requires exactly six digits', () => {
    expect(assertValidOpsOtpCode('521676')).toBe('521676');
    expect(() => assertValidOpsOtpCode('12345')).toThrow('OTP must be exactly 6 digits');
  });

  it('parseOpsOtpCodeInput throws AppError for incomplete values', () => {
    expect(parseOpsOtpCodeInput('654 321')).toBe('654321');
    expect(() => parseOpsOtpCodeInput('12 34')).toThrow(AppError);
  });
});
