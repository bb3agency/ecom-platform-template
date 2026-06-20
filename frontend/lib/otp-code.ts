/** Strip non-digits and cap at 6 characters for OTP inputs. */
export function normalizeOtpCodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isCompleteOtpCode(value: string): boolean {
  return normalizeOtpCodeInput(value).length === 6;
}
