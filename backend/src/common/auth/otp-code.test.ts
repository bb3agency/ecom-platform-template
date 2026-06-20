import { describe, expect, it } from 'vitest';
import { AppError } from '@common/errors/app-error';
import { normalizeOtpCode, parseOtpCodeInput } from './otp-code.js';

describe('otp-code', () => {
  it('normalizes spaced and dashed OTP input', () => {
    expect(normalizeOtpCode('5 2 1 6 7 6')).toBe('521676');
    expect(normalizeOtpCode('521-676')).toBe('521676');
  });

  it('parseOtpCodeInput rejects incomplete values', () => {
    expect(parseOtpCodeInput('654 321')).toBe('654321');
    expect(() => parseOtpCodeInput('12 34')).toThrow(AppError);
  });
});
