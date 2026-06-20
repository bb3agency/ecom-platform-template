/**
 * UI-only hints for local development. Not a security control.
 * Requires both NODE_ENV=development (Next dev server) and explicit public flag.
 */
export function isAuthDevBypassUiEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_AUTH_DEV_BYPASS === "true"
  );
}

export function getAuthDevOtpHint(): string {
  if (!isAuthDevBypassUiEnabled()) {
    return "000000";
  }
  return process.env.NEXT_PUBLIC_AUTH_DEV_OTP?.trim() || "000000";
}
