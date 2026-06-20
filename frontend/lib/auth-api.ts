import { apiClient } from "@/lib/api";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { User } from "@/types/user";
import {
  checkIdentifierInputSchema,
  emailLoginInputSchema,
  emailRegisterInputSchema,
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  sendOtpInputSchema,
  signupPhoneInputSchema,
  verifyOtpInputSchema,
} from "@/lib/validators";

export interface RefreshTokenResponse {
  accessToken: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  user: User;
}

export interface SendOtpInput {
  phone: string;
  channel?: "sms" | "whatsapp" | "email";
  email?: string;
  turnstileToken?: string;
}

export interface VerifyOtpInput {
  phone: string;
  otp: string;
}

export interface SignupPhoneInput {
  phone: string;
  otp: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface EmailRegisterInput {
  firstName: string;
  lastName: string;
  /** Optional for email registration — not required. Empty string is treated as absent. */
  phone?: string;
  email: string;
  password: string;
  turnstileToken?: string;
}

export interface CheckIdentifierInput {
  identifier: string;
}

export interface CheckIdentifierResponse {
  exists: boolean;
  identifierType: "phone" | "email";
  hasPhone: boolean;
}

export interface EmailLoginInput {
  /** Phone number or email address. Backend detects the type. */
  identifier: string;
  password: string;
  turnstileToken?: string;
}

export interface ForgotPasswordInput {
  email: string;
  turnstileToken?: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface OtpChannelConfigResponse {
  channel: "sms" | "whatsapp" | "email";
  availableChannels: Array<"sms" | "whatsapp" | "email">;
}

export async function refreshAccessToken(): Promise<RefreshTokenResponse> {
  return apiClient<RefreshTokenResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getOtpChannelConfig(): Promise<OtpChannelConfigResponse> {
  return apiClient<OtpChannelConfigResponse>("/auth/otp-channel", {
    method: "GET",
  });
}

export async function sendOtp(input: SendOtpInput): Promise<{ message: string }> {
  const body = sendOtpInputSchema.parse(input);
  return apiClient<{ message: string }>("/auth/send-otp", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function verifyOtp(input: VerifyOtpInput): Promise<AuthSessionResponse> {
  const body = verifyOtpInputSchema.parse(input);
  return apiClient<AuthSessionResponse>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function verifyOtpAndSignup(
  input: SignupPhoneInput,
): Promise<AuthSessionResponse> {
  const body = signupPhoneInputSchema.parse(input);
  return apiClient<AuthSessionResponse>("/auth/signup-phone", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function registerWithEmail(
  input: EmailRegisterInput,
): Promise<AuthSessionResponse> {
  const body = emailRegisterInputSchema.parse(input);
  return apiClient<AuthSessionResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
    credentials: "include",
  });
}

/**
 * Check whether a phone number or email address belongs to a registered user.
 * Used by login forms to give "not registered" feedback before the OTP or
 * password step.  Does NOT reveal any account details beyond existence.
 */
export async function checkIdentifier(
  input: CheckIdentifierInput,
): Promise<CheckIdentifierResponse> {
  const body = checkIdentifierInputSchema.parse(input);
  return apiClient<CheckIdentifierResponse>("/auth/check-identifier", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function loginWithEmail(
  input: EmailLoginInput,
): Promise<AuthSessionResponse> {
  const body = emailLoginInputSchema.parse(input);
  return apiClient<AuthSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function requestPasswordReset(
  input: ForgotPasswordInput,
  idempotencyKey = createIdempotencyKey(),
): Promise<{ message: string }> {
  const body = forgotPasswordInputSchema.parse(input);
  return apiClient<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify(body),
  });
}

export async function resetPassword(
  input: ResetPasswordInput,
  idempotencyKey = createIdempotencyKey(),
): Promise<{ message: string }> {
  const body = resetPasswordInputSchema.parse(input);
  return apiClient<{ message: string }>("/auth/reset-password", {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify(body),
  });
}

export async function logoutSession(accessToken: string | null): Promise<void> {
  await apiClient<void>("/auth/logout", {
    method: "POST",
    accessToken,
    body: JSON.stringify({}),
  });
}
