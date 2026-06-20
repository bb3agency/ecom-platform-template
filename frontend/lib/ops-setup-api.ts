import { apiClient } from "@/lib/api";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { normalizeOtpCodeInput } from "@/lib/otp-code";

export interface SendOpsSetupOtpInput {
  token: string;
  name: string;
  phone?: string;
}

export interface SendOpsSetupOtpResponse {
  message: string;
  expiresAt: string;
}

export interface ConsumeOpsInviteInput {
  token: string;
  otp: string;
}

export interface ConsumeOpsInviteResponse {
  opsUserId: string;
  email: string;
  name: string;
  permissions: string[];
}

export async function sendOpsSetupOtp(input: SendOpsSetupOtpInput) {
  return apiClient<SendOpsSetupOtpResponse>("/ops/invites/setup/send-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function consumeOpsInvite(input: ConsumeOpsInviteInput) {
  return apiClient<ConsumeOpsInviteResponse>("/ops/invites/consume", {
    method: "POST",
    body: JSON.stringify({ ...input, otp: normalizeOtpCodeInput(input.otp) }),
  });
}

export { getApiErrorMessageWithHint as getOpsSetupErrorMessage };
