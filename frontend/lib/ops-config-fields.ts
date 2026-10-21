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
   * Plaintext DB-stored value, used to prefill NON-secret inputs (provider
   * names, booleans, sender addresses) so the operator edits what is saved.
   *
   * Never populated for secret-classified keys (`inputKind === "secret"`):
   * the console shows `storedMasked` instead and an empty input means "keep
   * the saved value". The backend still returns plaintext for every row
   * (see `getStoredConfigSecrets`); the UI deliberately drops it for secrets
   * so a plaintext secret never sits in React state or the DOM.
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
  /** Saved value isn't live yet — the API/workers need a restart. */
  restartPending: boolean;
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
  "OTP_WHATSAPP_ENABLED",
  "PAYMENT_PROVIDER_FAILOVER_ENABLED",
  "SHIPPING_PROVIDER_FAILOVER_ENABLED",
]);

/** Secret-classified keys never have their stored value loaded into the page. */
export function isSecretKey(key: string): boolean {
  if (
    key.endsWith("_KEY_ID") ||
    key.endsWith("_FROM") ||
    key.endsWith("_EMAIL") ||
    key === "R2_ACCESS_KEY_ID"
  ) {
    return false;
  }
  return /(_SECRET|_TOKEN|_PASSWORD|_AUTH_KEY|_API_KEY|_APP_SECRET|_ENCRYPTION_KEY|_PRIVATE_KEY|_SIGNING_KEY|OPS_METRICS_TOKEN|REPLAY_APPROVAL_TOKEN|OPS_COOKIE_SECRET)/.test(
    key,
  );
}

/** Kept upper-case when a key is turned into a label. */
const ACRONYMS = new Set([
  "API", "CDN", "DB", "DLQ", "GST", "GSTIN", "ID", "IP", "JWT", "OTP", "R2", "S3", "SMS", "SMTP", "TTL", "URL", "UPI",
]);

/** "RAZORPAY_KEY_ID" → "Razorpay key ID" (sentence case, acronyms kept). */
function humanizeKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part, index) => {
      if (ACRONYMS.has(part)) return part;
      const lower = part.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
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
          restartPending: item.restartPending ?? (!item.present && Boolean(storedItem)),
          ...(storedItem ? { storedMasked: storedItem.maskedValue } : {}),
          ...(storedItem && inputKind !== "secret" ? { storedPlaintext: storedItem.plaintextValue } : {}),
        };
      }),
  );
}

export function groupOpsConfigFieldsByDomain(
  fields: OpsConfigFieldDefinition[],
): Array<{ domain: OpsConfigDomain; label: string; fields: OpsConfigFieldDefinition[] }> {
  const domainLabels: Record<OpsConfigDomain, string> = {
    core: "Core runtime",
    media: "Product media (Cloudflare R2)",
    payments: "Payments",
    shipping: "Shipping",
    notifications: "Notifications",
    opsSecurity: "Ops security",
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
