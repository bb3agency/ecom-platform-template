import { apiClient } from "@/lib/api";
import { normalizeOtpCodeInput } from "@/lib/otp-code";

export interface SendAdminSetupOtpInput {
  token: string;
  name: string;
  password: string;
  phone?: string;
}

export interface SendAdminSetupOtpResponse {
  message: string;
  expiresAt: string;
}

export interface ConsumeAdminInviteInput {
  token: string;
  otp: string;
}

export interface ConsumeAdminInviteResponse {
  adminUserId: string;
  email: string;
  name: string;
  permissions: string[];
}

export async function sendAdminSetupOtp(input: SendAdminSetupOtpInput) {
  return apiClient<SendAdminSetupOtpResponse>("/admin/invites/setup/send-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function consumeAdminInvite(input: ConsumeAdminInviteInput) {
  return apiClient<ConsumeAdminInviteResponse>("/admin/invites/consume", {
    method: "POST",
    body: JSON.stringify({ ...input, otp: normalizeOtpCodeInput(input.otp) }),
  });
}
