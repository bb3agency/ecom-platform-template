import { describe, expect, it } from "vitest";

import { buildOpsConfigFieldDefinitions, isSecretKey } from "./ops-config-fields";
import type { OpsConfigOverview, OpsStoredConfig } from "./ops-client-api";

describe("isSecretKey", () => {
  it("treats credentials as secret (password input with a reveal toggle)", () => {
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

describe("buildOpsConfigFieldDefinitions", () => {
  it("prefills saved secrets too, so operators can see what is stored (owner policy)", () => {
    const overview = {
      generatedAt: "",
      runtimeProfile: "production-like",
      domains: [
        {
          domain: "payments",
          label: "Payments",
          items: [
            { key: "RAZORPAY_KEY_SECRET", present: true, placeholder: false, mutableViaOps: true, requiresRestart: true, runtimeSource: "db-overlay" },
            { key: "RAZORPAY_KEY_ID", present: true, placeholder: false, mutableViaOps: true, requiresRestart: true, runtimeSource: "db-overlay" },
          ],
        },
      ],
      strictProfileHealth: { noPlaceholdersInStrict: true, missingRequiredKeysInStrict: [] },
    } as OpsConfigOverview;
    const stored = {
      items: [
        { domain: "payments", key: "RAZORPAY_KEY_SECRET", maskedValue: "ab****yz", plaintextValue: "abcdefxyz", keyVersion: 1, requiresRestart: true },
        { domain: "payments", key: "RAZORPAY_KEY_ID", maskedValue: "rz****01", plaintextValue: "rzp_live_01", keyVersion: 1, requiresRestart: true },
      ],
    } as unknown as OpsStoredConfig;

    const [secret, id] = buildOpsConfigFieldDefinitions(overview, stored);
    expect(secret).toMatchObject({ key: "RAZORPAY_KEY_SECRET", inputKind: "secret", storedPlaintext: "abcdefxyz" });
    expect(id).toMatchObject({ key: "RAZORPAY_KEY_ID", inputKind: "text", storedPlaintext: "rzp_live_01" });
  });
});
