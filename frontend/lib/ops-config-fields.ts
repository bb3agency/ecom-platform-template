import type { OpsConfigOverview, OpsStoredConfig } from "@/lib/ops-client-api";

export type OpsConfigDomain = OpsConfigOverview["domains"][number]["domain"];

export interface OpsConfigFieldDefinition {
  key: string;
  domain: OpsConfigDomain;
  label: string;
  hint?: string;
  inputKind: "text" | "secret" | "boolean" | "select";
  options?: Array<{ value: string; label: string }>;
  requiresRestart: boolean;
  /** Runtime value exists in `process.env` (sourced from env file *or* DB overlay). */
  present: boolean;
  /** Masked representation of the DB-stored value, retained for list/summary views. */
  storedMasked?: string;
  /**
   * Plaintext DB-stored value — populated for **every** key with an active
   * DB-overlay row, INCLUDING real cryptographic secrets (`_SECRET`,
   * `_TOKEN`, `_PASSWORD`, `_API_KEY`, `_AUTH_KEY`, `_APP_SECRET`, signed
   * approval tokens, ops cookie secret). Used to prefill the form input so
   * the operator can see and edit what is actually saved without retyping
   * from an external vault. Secret-classified fields still render as
   * `<input type="password">` with an eye toggle, so the rendered DOM stays
   * bullet-masked until the operator opts to peek. See backend
   * `getStoredConfigSecrets` JSDoc for the full rationale.
   */
  storedPlaintext?: string;
  /**
   * True only when the runtime value is sourced from the deployment env
   * file (i.e. `present && !storedMasked`). When the value comes from a
   * DB-overlay row, the field stays editable — otherwise once a key is
   * saved via Ops UI and the API restarts, the editor would permanently
   * lock it because `applyOpsConfigRuntimeOverlay` writes DB-stored
   * values into `process.env` and makes them look env-locked.
   */
  envLocked: boolean;
}

const SELECT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  PAYMENT_PROVIDER: [
    { value: "razorpay", label: "Razorpay" },
  ],
  SMS_PROVIDER: [
    { value: "msg91", label: "MSG91" },
    { value: "fast2sms", label: "Fast2SMS" },
    { value: "noop", label: "Noop (dev only)" },
  ],
  EMAIL_PROVIDER: [{ value: "resend", label: "Resend" }],
  MEDIA_STORAGE_PROVIDER: [
    { value: "r2", label: "Cloudflare R2 (production)" },
    { value: "local", label: "Local VPS disk (development)" },
  ],
};

const BOOLEAN_KEYS = new Set([
  "NOTIFY_EMAIL_ENABLED",
  "NOTIFY_SMS_ENABLED",
  "NOTIFY_WHATSAPP_ENABLED",
  "PAYMENT_PROVIDER_FAILOVER_ENABLED",
  "SHIPPING_PROVIDER_FAILOVER_ENABLED",
]);

function isSecretKey(key: string): boolean {
  if (
    key.endsWith("_KEY_ID") ||
    key.endsWith("_FROM") ||
    key.endsWith("_EMAIL") ||
    key === "R2_ACCESS_KEY_ID"
  ) {
    return false;
  }
  return /(_SECRET|_TOKEN|_PASSWORD|_AUTH_KEY|_API_KEY|_APP_SECRET|OPS_METRICS_TOKEN|REPLAY_APPROVAL_TOKEN|OPS_COOKIE_SECRET)/.test(
    key,
  );
}

function humanizeKey(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildOpsConfigFieldDefinitions(
  overview: OpsConfigOverview,
  stored: OpsStoredConfig,
): OpsConfigFieldDefinition[] {
  const storedByKey = new Map(stored.items.map((item) => [item.key, item] as const));

  return overview.domains.flatMap((group) =>
    group.items
      .filter((item) => item.mutableViaOps && item.runtimeSource !== "env-bootstrap")
      .map((item) => {
        const storedItem = storedByKey.get(item.key);
        // `envLocked` is true ONLY when the runtime value originated from
        // the deployment env file. If a DB-overlay row exists, the field
        // is editable even when `present === true`, because
        // `applyOpsConfigRuntimeOverlay` writes the saved value into
        // `process.env` and would otherwise make every DB-saved key look
        // permanently env-locked after the first API restart.
        const envLocked = item.present && !storedItem;
        const selectOptions = SELECT_OPTIONS[item.key];
        let inputKind: OpsConfigFieldDefinition["inputKind"] = "text";
        if (BOOLEAN_KEYS.has(item.key)) {
          inputKind = "boolean";
        } else if (selectOptions) {
          inputKind = "select";
        } else if (isSecretKey(item.key)) {
          inputKind = "secret";
        }

        return {
          key: item.key,
          domain: group.domain,
          label: humanizeKey(item.key),
          ...(item.note ? { hint: item.note } : {}),
          inputKind,
          ...(selectOptions ? { options: selectOptions } : {}),
          requiresRestart: item.requiresRestart,
          present: item.present,
          envLocked,
          ...(storedItem ? { storedMasked: storedItem.maskedValue } : {}),
          ...(storedItem ? { storedPlaintext: storedItem.plaintextValue } : {}),
        };
      }),
  );
}

export function groupOpsConfigFieldsByDomain(
  fields: OpsConfigFieldDefinition[],
): Array<{ domain: OpsConfigDomain; label: string; fields: OpsConfigFieldDefinition[] }> {
  const domainLabels: Record<OpsConfigDomain, string> = {
    core: "Core Runtime",
    media: "Product Media (Cloudflare R2)",
    payments: "Payments",
    shipping: "Shipping",
    notifications: "Notifications",
    opsSecurity: "Ops Security",
  };

  const order: OpsConfigDomain[] = [
    "core",
    "media",
    "payments",
    "shipping",
    "notifications",
    "opsSecurity",
  ];

  return order
    .map((domain) => ({
      domain,
      label: domainLabels[domain],
      fields: fields.filter((field) => field.domain === domain),
    }))
    .filter((group) => group.fields.length > 0);
}
