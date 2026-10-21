import { describe, expect, it } from "vitest";

import { isSecretKey } from "./ops-config-fields";

describe("isSecretKey", () => {
  it("treats credentials as secret (their stored value never reaches the page)", () => {
    for (const key of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "RESEND_API_KEY",
      "MSG91_AUTH_KEY",
      "META_WHATSAPP_ACCESS_TOKEN",
      "SHIPROCKET_PASSWORD",
      "R2_SECRET_ACCESS_KEY",
      "OPS_DB_ENCRYPTION_KEY",
      "JWT_SECRET",
    ]) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it("keeps public identifiers and addresses editable in the clear", () => {
    for (const key of ["RAZORPAY_KEY_ID", "R2_ACCESS_KEY_ID", "RESEND_FROM", "SHIPROCKET_EMAIL", "SMS_PROVIDER"]) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });
});
