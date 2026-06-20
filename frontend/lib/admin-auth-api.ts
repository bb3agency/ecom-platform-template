import { apiClient } from "@/lib/api";
import { parseAccessTokenClaims } from "@/lib/jwt-utils";
import { emailSchema, otpSchema, passwordSchema } from "@/lib/validators";
import { z } from "zod";
import type { AuthSession, User } from "@/types/user";

const adminLoginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  turnstileToken: z.string().max(4096).optional(),
});

const adminLoginVerifySchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

interface AdminLoginApiUser {
  id: string;
  email: string | null;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isVerified: boolean;
}

interface AdminLoginVerifyResponse {
  accessToken: string;
  admin: AdminLoginApiUser;
}

export interface AdminOtpChannelConfigResponse {
  channel: "sms" | "whatsapp" | "email";
  availableChannels: Array<"sms" | "whatsapp" | "email">;
}

function mapAdminUser(admin: AdminLoginApiUser, accessToken: string): User {
  const claims = parseAccessTokenClaims(accessToken);

  return {
    id: admin.id,
    email: admin.email ?? "",
    phone: admin.phone,
    firstName: admin.firstName,
    lastName: admin.lastName,
    isVerified: admin.isVerified,
    role: admin.role,
    permissions: claims?.permissions ?? [],
  };
}

/**
 * Admin login step 1 — verify email + password, enqueue OTP on success.
 *
 * - **200** — OTP issued; advance UI to OTP step (`expiresAt` + `message`).
 * - **401 `INVALID_CREDENTIALS`** — known admin, wrong password (no OTP sent).
 * - **401 `UNAUTHORISED`** — admin deactivated (`isBanned`); no OTP sent.
 * - **200 generic message** — unknown email or non-admin role (anti-enumeration; no OTP sent).
 */
export async function requestAdminLoginOtp(
  input: z.infer<typeof adminLoginRequestSchema>,
): Promise<{ expiresAt: string; message?: string; devOtp?: string }> {
  const body = adminLoginRequestSchema.parse(input);
  return apiClient("/auth/admin/login/request-otp", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getAdminOtpChannelConfig(): Promise<AdminOtpChannelConfigResponse> {
  return apiClient<AdminOtpChannelConfigResponse>("/auth/admin/otp-channel", {
    method: "GET",
  });
}

export async function verifyAdminLoginOtp(
  input: z.infer<typeof adminLoginVerifySchema>,
): Promise<AuthSession> {
  const body = adminLoginVerifySchema.parse(input);
  const response = await apiClient<AdminLoginVerifyResponse>(
    "/auth/admin/login/verify-otp",
    {
      method: "POST",
      body: JSON.stringify(body),
      credentials: "include",
    },
  );

  return {
    accessToken: response.accessToken,
    user: mapAdminUser(response.admin, response.accessToken),
  };
}
