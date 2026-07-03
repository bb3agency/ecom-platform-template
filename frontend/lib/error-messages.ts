import { ApiError } from "@/lib/api";
import { isTurnstileConfigured } from "@/lib/turnstile-config";

/** User-facing copy keyed by backend `error.code` — never branch on message text. */
const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "Please check the highlighted fields and try again.",
  TOKEN_EXPIRED: "Your session expired. Please sign in again.",
  UNAUTHORISED: "Please sign in to continue.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  FORBIDDEN: "You do not have permission to perform this action.",
  ADMIN_MFA_SETUP_REQUIRED:
    "Multi-factor authentication must be enabled before you can sign in. If enforcement was just turned on, ask your operator to complete MFA enrollment or temporarily disable ADMIN_MFA_ENFORCE for first-time setup.",
  ADMIN_MFA_CODE_REQUIRED: "Enter the 6-digit code from your authenticator app.",
  NOT_FOUND: "The requested item could not be found.",
  CONFLICT:
    "This action conflicts with the current state. Refresh the page and retry only if you are starting a new action.",
  IDEMPOTENCY_CONFLICT:
    "This request was already processed. Refresh to see the latest state before retrying.",
  ops_audit_chain_lock_timeout:
    "Ops audit system is busy. Wait 1–2 seconds and retry this action.",
  INVALID_STATUS_TRANSITION: "This status change is not allowed right now.",
  INSUFFICIENT_STOCK: "Not enough stock is available for this quantity.",
  COUPON_EXPIRED: "This coupon has expired.",
  COUPON_USAGE_EXCEEDED: "This coupon has reached its usage limit.",
  PINCODE_NOT_SERVICEABLE: "Delivery is not available for this pincode. Try another address.",
  RATE_LIMIT_EXCEEDED: "Too many attempts. Please wait a moment and try again.",
  ORDER_NOT_FOUND: "Order not found.",
  CONFIG_NOT_READY:
    "Runtime configuration is incomplete. Save the missing keys below, then restart API and workers.",
  PAYMENT_VERIFICATION_FAILED:
    "We could not verify your payment. If money was debited, it will be refunded automatically — check your order history or contact support.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

const RETRYABLE_CODES = new Set([
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_ERROR",
  "UNKNOWN_ERROR",
  "ops_audit_chain_lock_timeout",
]);

const CONFLICT_CODES = new Set(["CONFLICT", "IDEMPOTENCY_CONFLICT"]);

const AUTH_FAILURE_CODES = new Set([
  "UNAUTHORISED",
  "INVALID_CREDENTIALS",
  "TOKEN_EXPIRED",
]);

export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN_ERROR;
}

export function getOpsLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const opsOtpMessage = getOpsOtpErrorMessage(error);
    if (opsOtpMessage) {
      return opsOtpMessage;
    }
    if (error.code === "INVALID_CREDENTIALS") {
      const message = (error.message ?? "").toLowerCase();
      if (message.includes("otp") || message.includes("login code")) {
        return "That login code is invalid or has expired. Request a new code and try again.";
      }
    }
  }
  return getApiErrorMessage(error);
}

export function getAdminLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const otpMessage = getOpsOtpErrorMessage(error);
    if (otpMessage) {
      return otpMessage;
    }
    if (error.code === "INVALID_CREDENTIALS") {
      const message = (error.message ?? "").toLowerCase();
      if (message.includes("otp") || message.includes("login code") || message.includes("one-time")) {
        return "That login code is invalid or has expired. Request a new code and try again.";
      }
      return "Incorrect password.";
    }
    if (
      error.status === 403 &&
      error.message.toLowerCase().includes("mfa setup is required")
    ) {
      return ERROR_MESSAGES.ADMIN_MFA_SETUP_REQUIRED;
    }
    if (
      error.status === 401 &&
      error.message.toLowerCase().includes("mfa code is required")
    ) {
      return ERROR_MESSAGES.ADMIN_MFA_CODE_REQUIRED;
    }
    if (error.status === 401 && error.message.toLowerCase().includes("mfa code")) {
      return "The authenticator code is invalid. Try again.";
    }
  }
  return getApiErrorMessage(error);
}

function getAuthChallengeErrorMessage(error: ApiError): string | null {
  const message = (error.message ?? "").toLowerCase();
  if (
    error.code !== "VALIDATION_ERROR" ||
    (!message.includes("challenge") && !message.includes("turnstile"))
  ) {
    return null;
  }
  if (!isTurnstileConfigured()) {
    return (
      "The API requires a security check, but NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set. " +
      "Add the Cloudflare site key to frontend/.env.local (must pair with backend TURNSTILE_SECRET_KEY), " +
      "or clear TURNSTILE_SECRET_KEY in backend/.env for local development."
    );
  }
  return "Complete the security check below, then try again.";
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const otpMessage = getOpsOtpErrorMessage(error);
    if (otpMessage) {
      return otpMessage;
    }
    const challengeMessage = getAuthChallengeErrorMessage(error);
    if (challengeMessage) {
      return challengeMessage;
    }
    // CONFLICT / VALIDATION_ERROR AppError messages are crafted, user-safe copy that says exactly
    // what to do (e.g. "Cannot delete a variant that appears in existing orders. Deactivate it
    // instead."). Surface them instead of the generic mapped copy — the fallback previously
    // swallowed every specific 409/400 explanation, and fieldless VALIDATION_ERRORs showed
    // "check the highlighted fields" with nothing highlighted. Schema-level errors keep their
    // generic "Request validation failed" message and still fall through to the mapped copy.
    const serverMessage = (error.message ?? "").trim();
    if (
      serverMessage &&
      !GENERIC_BACKEND_MESSAGES.has(serverMessage) &&
      (error.code === "CONFLICT" || error.code === "VALIDATION_ERROR")
    ) {
      return serverMessage;
    }
    return getErrorMessage(error.code);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

export function isRetryableErrorCode(code: string): boolean {
  return RETRYABLE_CODES.has(code);
}

export function isConflictErrorCode(code: string): boolean {
  return CONFLICT_CODES.has(code) || code === "CONFLICT";
}

const GENERIC_BACKEND_MESSAGES = new Set([
  "Internal server error",
  // Generic 500 body — the backend strips internal detail from 500s (see error-handler.ts).
  "Something went wrong. Please try again later.",
  "Request validation failed",
  "Rate limit exceeded",
  "",
]);

function readHintKey(error: ApiError): string | undefined {
  if (
    typeof error.details === "object" &&
    error.details !== null &&
    "hintKey" in (error.details as Record<string, unknown>)
  ) {
    const value = (error.details as { hintKey?: unknown }).hintKey;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function readAttemptsRemaining(error: ApiError): number | undefined {
  if (
    typeof error.details === "object" &&
    error.details !== null &&
    "attemptsRemaining" in (error.details as Record<string, unknown>)
  ) {
    const value = (error.details as { attemptsRemaining?: unknown }).attemptsRemaining;
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}

function getOpsOtpErrorMessage(error: ApiError): string | null {
  const hintKey = readHintKey(error);
  const serverMessage = (error.message ?? "").toLowerCase();

  if (hintKey === "otp_invalid" || hintKey === "admin_login_otp_invalid") {
    return "That verification code is invalid or has expired. Request a new code and try again.";
  }

  if (hintKey === "ops_login_otp_invalid") {
    const remaining = readAttemptsRemaining(error);
    if (remaining !== undefined && remaining > 0) {
      return `That login code is incorrect. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
    }
    return "That login code is invalid or has expired. Request a new code and try again.";
  }

  if (hintKey === "ops_otp_invalid") {
    const remaining = readAttemptsRemaining(error);
    if (remaining !== undefined && remaining > 0) {
      return `The verification code is incorrect. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
    }
    return 'The verification code is incorrect. Click "Send OTP to email" to request a new code.';
  }

  if (hintKey === "ops_otp_expired" || (error.code === "TOKEN_EXPIRED" && serverMessage.includes("otp challenge"))) {
    return 'Your verification code has expired. Click "Send OTP to email" to request a new code.';
  }

  if (error.code === "UNAUTHORISED" && serverMessage.includes("invalid otp")) {
    return "The verification code is incorrect. Check the latest email and try again, or request a new code.";
  }

  if (error.code === "UNAUTHORISED" && serverMessage.includes("ops authentication required")) {
    return "Your ops session expired. Sign in again, then request a new OTP and retry.";
  }

  return null;
}

export function getApiErrorMessageWithHint(error: unknown): string {
  if (error instanceof ApiError) {
    const opsOtpMessage = getOpsOtpErrorMessage(error);
    if (opsOtpMessage) {
      return opsOtpMessage;
    }

    const serverMessage = (error.message ?? "").trim();
    if (
      serverMessage &&
      !GENERIC_BACKEND_MESSAGES.has(serverMessage) &&
      (error.code === "CONFLICT" || error.code === "VALIDATION_ERROR")
    ) {
      return serverMessage;
    }
  }
  const message = getApiErrorMessage(error);
  if (error instanceof ApiError) {
    const hintKey = readHintKey(error);
    if (
      hintKey === "ops_otp_challenge_not_pending" ||
      hintKey === "ops_otp_challenge_consumed_concurrently"
    ) {
      return "Your OTP code has already been used or is no longer valid. Click \"Send OTP to email\" to request a new code, then retry.";
    }
    if (hintKey === "ops_restart_queue_unavailable") {
      return "Restart queue is not available. Backend must be restarted manually (docker compose up -d backend workers) and BullMQ + Redis verified healthy before retrying.";
    }
    if (hintKey === "ops_restart_enqueue_failed") {
      return "Unable to schedule restart because the cart-cleanup queue rejected the job. Check workers and Redis health, then retry.";
    }
    if (hintKey === "ops_restart_load_shed_set_failed") {
      return "Unable to schedule restart because load-shed state could not be updated. Check Redis health and retry.";
    }
    if (hintKey === "ops_restart_audit_failed") {
      return "Unable to schedule restart because the audit record could not be written. Check Postgres connectivity and retry.";
    }
    if (error.code === "CONFIG_NOT_READY") {
      const fields = error.details?.fields ?? [];
      const missingKeys = fields
        .map((item) => item.field)
        .filter((field) => typeof field === "string" && field.trim().length > 0);
      if (missingKeys.length > 0) {
        return `${message} Missing keys: ${missingKeys.join(", ")}.`;
      }
      return message;
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return `${message} Do not resubmit the same idempotency key for a new user action.`;
    }
    if (isRetryableErrorCode(error.code)) {
      return `${message} You can safely retry after a short pause.`;
    }
  }
  return message;
}

/**
 * Returns a secondary diagnostic line for ops/admin operators with the actual
 * backend `error.message` whenever it's specific enough to be useful. Returns
 * `null` for generic backend messages (e.g. "Internal server error") so the UI
 * doesn't render redundant noise. Operators are trusted, so it's safe to show
 * AppError messages (they're crafted by us, not raw stack traces).
 */
export function getOpsErrorDetail(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  const trimmed = (error.message ?? "").trim();
  if (!trimmed || GENERIC_BACKEND_MESSAGES.has(trimmed)) {
    return null;
  }
  const hintKey = readHintKey(error);
  const parts: string[] = [`Server: ${trimmed}`];
  if (hintKey && hintKey !== "internal_error" && hintKey !== "request_failed") {
    parts.push(`hint=${hintKey}`);
  }
  parts.push(`code=${error.code}`);
  return parts.join(" · ");
}

export function isAuthFailureCode(code: string): boolean {
  return AUTH_FAILURE_CODES.has(code);
}

/**
 * Returns true if the error indicates the operator's OTP challenge can no
 * longer be used (already verified, expired, or concurrently consumed) and
 * the UI should clear the challenge/OTP state so the user requests a fresh
 * code instead of resubmitting the same one.
 */
const OPS_OTP_HINT_KEYS = new Set([
  "ops_otp_invalid",
  "ops_otp_expired",
  "ops_otp_invalid_format",
  "ops_login_otp_invalid",
  "otp_invalid",
  "otp_invalid_format",
  "admin_login_otp_invalid",
]);

/**
 * True when a 401 means the ops browser session is missing/expired — not a wrong OTP.
 */
export function isOpsSessionAuthFailure(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) {
    return false;
  }

  const hintKey = readHintKey(error);
  if (hintKey && OPS_OTP_HINT_KEYS.has(hintKey)) {
    return false;
  }

  const serverMessage = (error.message ?? "").toLowerCase();
  if (error.code === "INVALID_CREDENTIALS") {
    return false;
  }
  if (error.code === "TOKEN_EXPIRED" && serverMessage.includes("otp challenge")) {
    return false;
  }

  return error.code === "UNAUTHORISED" || error.code === "TOKEN_EXPIRED";
}

export function isOpsOtpVerificationError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  const hintKey = readHintKey(error);
  if (hintKey && OPS_OTP_HINT_KEYS.has(hintKey)) {
    return true;
  }
  if (error.code === "INVALID_CREDENTIALS") {
    const serverMessage = (error.message ?? "").toLowerCase();
    return serverMessage.includes("otp");
  }
  if (error.code === "UNAUTHORISED") {
    return (error.message ?? "").toLowerCase().includes("invalid otp");
  }
  return false;
}

export function isOpsOtpChallengeConsumed(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  const hintKey = readHintKey(error);
  if (
    hintKey === "ops_otp_challenge_not_pending" ||
    hintKey === "ops_otp_challenge_consumed_concurrently" ||
    hintKey === "ops_otp_expired"
  ) {
    return true;
  }
  if (hintKey === "ops_otp_invalid") {
    const remaining = readAttemptsRemaining(error);
    return remaining !== undefined && remaining <= 0;
  }
  // Backstop: any CONFLICT 409 on an ops critical-OTP route means the
  // challenge is no longer usable (verifyEmailOtp is the only 409-producing
  // step before the action runs). Treat it the same way even if the backend
  // hasn't been redeployed with the new hint keys yet.
  return error.status === 409 && error.code === "CONFLICT";
}

export function shouldAttemptTokenRefresh(error: ApiError): boolean {
  return (
    error.status === 401 &&
    (error.code === "TOKEN_EXPIRED" || error.code === "UNAUTHORISED")
  );
}

export function shouldForceLogin(error: ApiError): boolean {
  if (error.status !== 401) {
    return false;
  }
  // Wrong OTP/password must not clear an otherwise valid access-token session.
  if (error.code === "INVALID_CREDENTIALS") {
    return false;
  }
  const hintKey = readHintKey(error);
  if (hintKey && OPS_OTP_HINT_KEYS.has(hintKey)) {
    return false;
  }
  return error.code === "UNAUTHORISED" || error.code === "TOKEN_EXPIRED";
}

export function isApiErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}
