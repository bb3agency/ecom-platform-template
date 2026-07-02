export type OpsConfigDomain = 'core' | 'media' | 'payments' | 'shipping' | 'notifications' | 'opsSecurity';

export type OpsConfigOverviewItem = {
  key: string;
  mutableViaOps: boolean;
  requiresRestart: boolean;
  runtimeSource?: 'env-bootstrap' | 'db-overlay';
  note?: string;
};

export const OPS_CONFIG_BOOTSTRAP_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'OPS_DB_ENCRYPTION_KEY'
] as const;

const OPS_CONFIG_BOOTSTRAP_ENV_KEY_SET = new Set<string>(OPS_CONFIG_BOOTSTRAP_ENV_KEYS);

export const OPS_CONFIG_OVERVIEW_GROUPS: Array<{
  domain: OpsConfigDomain;
  label: string;
  items: OpsConfigOverviewItem[];
}> = [
  {
    domain: 'core',
    label: 'Core Runtime',
    items: [
      { key: 'NODE_ENV', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'Process mode switch; must be set in deployment environment. Changing via DB overlay would silently downgrade the security profile.' },
      { key: 'CLIENT_ID', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'Infrastructure identity key set at deploy time; must not be overrideable via DB.' },
      { key: 'DATABASE_URL', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'Bootstrap-only: must come from deployment environment before DB config can be read.' },
      { key: 'REDIS_URL', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'Bootstrap-only initial Redis URL; DB overlay cannot be used to establish the first Redis connection.' },
      { key: 'JWT_SECRET', mutableViaOps: true, requiresRestart: true },
      { key: 'JWT_REFRESH_SECRET', mutableViaOps: true, requiresRestart: true },
      { key: 'INVOICE_STORAGE_ROOT', mutableViaOps: true, requiresRestart: true }
    ]
  },
  {
    domain: 'media',
    label: 'Product Media (Cloudflare R2)',
    items: [
      {
        key: 'MEDIA_STORAGE_PROVIDER',
        mutableViaOps: true,
        requiresRestart: true,
        runtimeSource: 'db-overlay',
        note: 'local = VPS disk + origin serve; r2 = automatic upload to Cloudflare R2 on each admin image save.'
      },
      { key: 'R2_ACCOUNT_ID', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'R2_ACCESS_KEY_ID', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'R2_SECRET_ACCESS_KEY', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'R2_BUCKET_NAME', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      {
        key: 'R2_PUBLIC_BASE_URL',
        mutableViaOps: true,
        requiresRestart: true,
        runtimeSource: 'db-overlay',
        note: 'Public CDN hostname on the R2 bucket (custom domain). Pair with storefront NEXT_PUBLIC_IMAGE_CDN_URL.'
      },
      {
        key: 'R2_ENDPOINT',
        mutableViaOps: true,
        requiresRestart: true,
        runtimeSource: 'db-overlay',
        note: 'Optional S3 API endpoint override. Default: https://<account_id>.r2.cloudflarestorage.com'
      },
      {
        key: 'MEDIA_STORAGE_ROOT',
        mutableViaOps: true,
        requiresRestart: true,
        runtimeSource: 'db-overlay',
        note: 'Used when MEDIA_STORAGE_PROVIDER=local (dev). Optional legacy VPS path for delete fallback.'
      },
      {
        key: 'MEDIA_CDN_BASE_URL',
        mutableViaOps: true,
        requiresRestart: true,
        runtimeSource: 'db-overlay',
        note: 'Fallback public origin for local provider URLs. Prefer R2_PUBLIC_BASE_URL in production.'
      }
    ]
  },
  {
    domain: 'payments',
    label: 'Payments',
    items: [
      { key: 'PAYMENT_PROVIDER', mutableViaOps: true, requiresRestart: true },
      { key: 'PAYMENT_PROVIDER_FAILOVER_ENABLED', mutableViaOps: true, requiresRestart: true },
      { key: 'PAYMENT_CB_FAILURE_THRESHOLD', mutableViaOps: true, requiresRestart: true },
      { key: 'PAYMENT_CB_COOLDOWN_MS', mutableViaOps: true, requiresRestart: true },
      { key: 'RAZORPAY_KEY_ID', mutableViaOps: true, requiresRestart: true },
      { key: 'RAZORPAY_KEY_SECRET', mutableViaOps: true, requiresRestart: true },
      { key: 'RAZORPAY_WEBHOOK_SECRET', mutableViaOps: true, requiresRestart: true },
      { key: 'RAZORPAY_WEBHOOK_SECRET_OLD', mutableViaOps: true, requiresRestart: true, note: 'Optional secret used during webhook secret rotation.' },
      { key: 'RAZORPAY_WEBHOOK_ALLOWLIST_CIDR', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS', mutableViaOps: true, requiresRestart: true }
    ]
  },
  {
    domain: 'shipping',
    label: 'Shipping',
    items: [
      {
        key: 'SHIPPING_PROVIDER',
        mutableViaOps: false,
        requiresRestart: true,
        note: 'Not used by the routing logic. Routing is fully auto-detected from credentials: both DELHIVERY_API_KEY and SHIPROCKET_EMAIL/PASSWORD set → dual mode (cheapest rate per order wins); only one set → that provider is used. Set credentials below — do not change this field.'
      },
      { key: 'SHIPPING_PROVIDER_FAILOVER_ENABLED', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPPING_CB_FAILURE_THRESHOLD', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPPING_CB_COOLDOWN_MS', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPPING_WEBHOOK_ALLOWLIST_CIDR', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'DELHIVERY_API_KEY', mutableViaOps: true, requiresRestart: true },
      {
        key: 'DELHIVERY_BASE_URL',
        mutableViaOps: true,
        requiresRestart: true,
        note: 'Override API host. Production: https://track.delhivery.com  Staging: https://staging-express.delhivery.com  (no /api suffix)'
      },
      {
        key: 'DELHIVERY_PICKUP_LOCATION',
        mutableViaOps: true,
        requiresRestart: true,
        note: 'Warehouse/pickup name exactly as registered in Delhivery dashboard (required for shipment creation)'
      },
      { key: 'DELHIVERY_PICKUP_PINCODE', mutableViaOps: true, requiresRestart: true },
      { key: 'DELHIVERY_SELLER_NAME', mutableViaOps: true, requiresRestart: true, note: 'Store/seller name used in return address fields' },
      { key: 'DELHIVERY_SELLER_ADDRESS', mutableViaOps: true, requiresRestart: true, note: 'Seller address line for return address' },
      { key: 'DELHIVERY_SELLER_CITY', mutableViaOps: true, requiresRestart: true },
      { key: 'DELHIVERY_SELLER_STATE', mutableViaOps: true, requiresRestart: true },
      { key: 'DELHIVERY_SELLER_PHONE', mutableViaOps: true, requiresRestart: true },
      {
        key: 'DELHIVERY_WEBHOOK_TOKEN',
        mutableViaOps: true,
        requiresRestart: true,
        runtimeSource: 'db-overlay',
        note: 'Optional. A secret token you create and tell Delhivery to echo in the Authorization header on every webhook push. If not set, all incoming Delhivery webhooks are accepted — use SHIPPING_WEBHOOK_ALLOWLIST_CIDR as the security layer instead. Delhivery does not generate or provide this token; you supply it when registering your webhook endpoint with your account manager.'
      },
      { key: 'DELHIVERY_WEBHOOK_ALLOWLIST_CIDR', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPROCKET_EMAIL', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPROCKET_BASE_URL', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPROCKET_PICKUP_PINCODE', mutableViaOps: true, requiresRestart: true },
      {
        key: 'SHIPROCKET_PICKUP_LOCATION',
        mutableViaOps: true,
        requiresRestart: true,
        note: 'Pickup address nickname in Shiprocket dashboard (defaults to Primary when unset)'
      },
      { key: 'SHIPROCKET_PASSWORD', mutableViaOps: true, requiresRestart: true },
      { key: 'SHIPROCKET_WEBHOOK_TOKEN', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay' },
      { key: 'SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS', mutableViaOps: true, requiresRestart: true }
    ]
  },
  {
    domain: 'notifications',
    label: 'Notifications',
    items: [
      { key: 'NOTIFY_EMAIL_ENABLED', mutableViaOps: true, requiresRestart: true },
      { key: 'NOTIFY_SMS_ENABLED', mutableViaOps: true, requiresRestart: true },
      { key: 'NOTIFY_WHATSAPP_ENABLED', mutableViaOps: true, requiresRestart: true },
      // OTP-over-WhatsApp is a distinct toggle: when on (and WhatsApp is deliverable), signup/login
      // and forgot-password OTPs are ALSO sent over WhatsApp in addition to the primary channel.
      // Read live per request, so no restart is required. Costs per message (see WHATSAPP_OTP_COST_PAISE).
      { key: 'OTP_WHATSAPP_ENABLED', mutableViaOps: true, requiresRestart: false, runtimeSource: 'db-overlay', note: 'true | false — also send auth OTP over WhatsApp (billed per message). Requires an approved AUTHENTICATION template.' },
      { key: 'WHATSAPP_OTP_COST_PAISE', mutableViaOps: true, requiresRestart: false, runtimeSource: 'db-overlay', note: 'Integer paise per WhatsApp OTP message, used only for the Ops cost estimate. Default 12 (~₹0.115 + GST).' },
      // Note: Per-template primary notification channels are DB-backed via StoreSettings.primaryNotificationChannels
      // and configurable via PATCH /api/v1/admin/settings/notifications — not via environment variables.
      { key: 'EMAIL_PROVIDER', mutableViaOps: true, requiresRestart: true, note: 'resend (currently the only supported provider; reserved for future provider selection)' },
      { key: 'SMS_PROVIDER', mutableViaOps: true, requiresRestart: true, note: 'msg91 | fast2sms | noop' },
      { key: 'RESEND_API_KEY', mutableViaOps: true, requiresRestart: true },
      { key: 'RESEND_FROM', mutableViaOps: true, requiresRestart: true },
      { key: 'MSG91_AUTH_KEY', mutableViaOps: true, requiresRestart: true },
      { key: 'MSG91_SENDER_ID', mutableViaOps: true, requiresRestart: true },
      { key: 'MSG91_ROUTE', mutableViaOps: true, requiresRestart: true },
      { key: 'FAST2SMS_API_KEY', mutableViaOps: true, requiresRestart: true },
      { key: 'META_WHATSAPP_ACCESS_TOKEN', mutableViaOps: true, requiresRestart: true },
      { key: 'META_WHATSAPP_PHONE_NUMBER_ID', mutableViaOps: true, requiresRestart: true },
      { key: 'META_WHATSAPP_API_VERSION', mutableViaOps: true, requiresRestart: true },
      { key: 'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN', mutableViaOps: true, requiresRestart: true },
      { key: 'META_WHATSAPP_APP_SECRET', mutableViaOps: true, requiresRestart: true }
    ]
  },
  {
    domain: 'opsSecurity',
    label: 'Ops Security',
    items: [
      { key: 'OPS_METRICS_TOKEN', mutableViaOps: true, requiresRestart: true },
      { key: 'OPS_METRICS_ALLOWLIST', mutableViaOps: true, requiresRestart: true },
      { key: 'OPS_DB_ENCRYPTION_KEY', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'Bootstrap-only encryption key required to decrypt DB-stored ops config.' },
      { key: 'REPLAY_APPROVAL_TOKEN', mutableViaOps: true, requiresRestart: true },
      { key: 'REPLAY_AUDIT_RETENTION_DAYS', mutableViaOps: true, requiresRestart: true, note: 'Number of days to retain replay audit NDJSON log entries. Read in analytics.service.ts.' },
      { key: 'TRUSTED_PROXY_ALLOWLIST_CIDR', mutableViaOps: true, requiresRestart: true, runtimeSource: 'db-overlay', note: 'CIDR allowlist for trusted reverse proxies. Read in main.ts, observability.plugin.ts, orders.routes.ts.' },
      { key: 'OPS_COOKIE_SECRET', mutableViaOps: true, requiresRestart: true, note: 'Secret used to sign ops session cookies. Rotate via ops UI; requires restart to take effect.' },
      { key: 'OPS_BROWSER_SESSION_TTL_SECONDS', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'Absolute TTL for ops browser sessions in Redis. Must be set in deployment environment.' },
      { key: 'OPS_LOGIN_OTP_TTL_SECONDS', mutableViaOps: false, requiresRestart: true, runtimeSource: 'env-bootstrap', note: 'TTL for ops login OTPs stored in Redis. Must be set in deployment environment.' }
    ]
  }
];

const OPS_CONFIG_MUTABLE_KEYS = new Set(
  OPS_CONFIG_OVERVIEW_GROUPS.flatMap((group) => group.items.filter((item) => item.mutableViaOps).map((item) => item.key))
);

const OPS_CONFIG_KNOWN_KEYS = new Set(
  OPS_CONFIG_OVERVIEW_GROUPS.flatMap((group) => group.items.map((item) => item.key))
);

// Shipping is intentionally absent from this map. Routing auto-detects from
// credentials via resolveDualShippingRuntime (SHIPPING_PROVIDER env var is unused).
// Shipping key requirements are computed directly from credential presence below.
const OPS_CONFIG_REQUIRED_BY_PROVIDER: Record<string, Record<string, string[]>> = {
  PAYMENT_PROVIDER: {
    razorpay: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
    cod: [],
    noop: []
  },
  SMS_PROVIDER: {
    msg91: ['MSG91_AUTH_KEY', 'MSG91_SENDER_ID'],
    fast2sms: ['FAST2SMS_API_KEY'],
    noop: []
  },
  MEDIA_STORAGE_PROVIDER: {
    r2: [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_NAME',
      'R2_PUBLIC_BASE_URL'
    ],
    local: [],
    'cloudflare-r2': [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_NAME',
      'R2_PUBLIC_BASE_URL'
    ]
  }
};

// Shipping strict requirements are handled credential-based in computeRequiredOpsConfigKeys.
const OPS_CONFIG_STRICT_ADDITIONAL_REQUIRED_BY_PROVIDER: Record<string, Record<string, string[]>> = {
  PAYMENT_PROVIDER: {
    razorpay: ['RAZORPAY_WEBHOOK_ALLOWLIST_CIDR']
  }
};

const OPS_CONFIG_REQUIRED_BY_FLAG: Record<string, string[]> = {
  NOTIFY_EMAIL_ENABLED: ['RESEND_API_KEY', 'RESEND_FROM'],
  NOTIFY_SMS_ENABLED: [],
  NOTIFY_WHATSAPP_ENABLED: [
    'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'META_WHATSAPP_APP_SECRET'
  ]
};

const OPS_CONFIG_STRICT_BASE_REQUIRED = [
  'OPS_METRICS_TOKEN',
  'REPLAY_APPROVAL_TOKEN'
];

function isEnabled(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

const OPS_PROVIDER_DEFAULTS: Record<string, string> = {
  PAYMENT_PROVIDER: 'razorpay',
  SMS_PROVIDER: 'msg91'
};

function getProviderValue(draftEnv: NodeJS.ProcessEnv, key: string): string {
  const raw = (draftEnv[key] ?? '').trim().toLowerCase();
  return raw || (OPS_PROVIDER_DEFAULTS[key] ?? '');
}

/**
 * Classifies an Ops config key as a "secret" (cryptographic credential, signed
 * token, password) vs a "non-secret" (provider selector, base URL, pincode,
 * allowlist CIDR, boolean flag, public ID, login email, sender address).
 *
 * Used by `getStoredConfigSecrets()` to decide whether a stored value is
 * returnable to the Ops UI as plaintext (non-secret — prefills the editable
 * field so the operator can see what was saved without retyping) or must stay
 * masked (secret — only the masked representation reaches the browser, per
 * the security rule: "Never show plaintext secret values in admin UI").
 *
 * Mirrors `frontend/lib/ops-config-fields.ts > isSecretKey` exactly — keep
 * the two regexes in sync. Both implementations:
 *   1. Early-return false for the three non-secret suffixes that look like
 *      they could match the regex but are intentionally public:
 *        - `_KEY_ID`        e.g. RAZORPAY_KEY_ID — Razorpay's *public* key id
 *        - `_FROM`          e.g. RESEND_FROM     — public sender address
 *        - `_EMAIL`         e.g. SHIPROCKET_EMAIL — login email (paired w/ password)
 *   2. Match the union of secret suffix patterns.
 *
 * @example
 *   isOpsConfigSecretKey('SHIPPING_PROVIDER')                  // false (selector)
 *   isOpsConfigSecretKey('SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS')// false (number)
 *   isOpsConfigSecretKey('RAZORPAY_KEY_ID')                    // false (public id, early-return)
 *   isOpsConfigSecretKey('RESEND_FROM')                        // false (sender address, early-return)
 *   isOpsConfigSecretKey('RAZORPAY_KEY_SECRET')                // true  (_SECRET)
 *   isOpsConfigSecretKey('SHIPROCKET_WEBHOOK_TOKEN')           // true  (_TOKEN)
 *   isOpsConfigSecretKey('SHIPROCKET_PASSWORD')                // true  (_PASSWORD)
 *   isOpsConfigSecretKey('RESEND_API_KEY')                     // true  (_API_KEY)
 *   isOpsConfigSecretKey('MSG91_AUTH_KEY')                     // true  (_AUTH_KEY)
 *   isOpsConfigSecretKey('META_WHATSAPP_APP_SECRET')           // true  (_APP_SECRET)
 *   isOpsConfigSecretKey('OPS_METRICS_TOKEN')                  // true  (exact match)
 *   isOpsConfigSecretKey('REPLAY_APPROVAL_TOKEN')              // true  (exact match)
 *   isOpsConfigSecretKey('OPS_COOKIE_SECRET')                  // true  (exact match)
 */
export function isOpsConfigSecretKey(key: string): boolean {
  if (
    key.endsWith('_KEY_ID') ||
    key.endsWith('_FROM') ||
    key.endsWith('_EMAIL') ||
    key === 'R2_ACCESS_KEY_ID'
  ) {
    return false;
  }
  return /(_SECRET|_TOKEN|_PASSWORD|_AUTH_KEY|_API_KEY|_APP_SECRET|OPS_METRICS_TOKEN|REPLAY_APPROVAL_TOKEN|OPS_COOKIE_SECRET)/.test(
    key
  );
}

export function isOpsConfigMutableKey(key: string): boolean {
  return OPS_CONFIG_MUTABLE_KEYS.has(key);
}

export function isOpsConfigKnownKey(key: string): boolean {
  return OPS_CONFIG_KNOWN_KEYS.has(key);
}

export function isOpsConfigBootstrapKey(key: string): boolean {
  return OPS_CONFIG_BOOTSTRAP_ENV_KEY_SET.has(key);
}

export function isOpsConfigRuntimeOverlayKey(key: string): boolean {
  return isOpsConfigMutableKey(key) && !isOpsConfigBootstrapKey(key);
}

export function listOpsConfigMutableKeys(): string[] {
  return [...OPS_CONFIG_MUTABLE_KEYS];
}

export function listOpsConfigRuntimeOverlayKeys(): string[] {
  return listOpsConfigMutableKeys().filter((key) => !isOpsConfigBootstrapKey(key));
}

export function resolveOpsConfigDomainForKey(key: string): OpsConfigDomain | null {
  for (const group of OPS_CONFIG_OVERVIEW_GROUPS) {
    if (group.items.some((item) => item.key === key)) {
      return group.domain;
    }
  }
  return null;
}

export function computeRequiredOpsConfigKeys(draftEnv: NodeJS.ProcessEnv, strictProfile: boolean): string[] {
  const required = new Set<string>([
    'PAYMENT_PROVIDER',
    // SHIPPING_PROVIDER omitted — routing auto-detects from credentials (resolveDualShippingRuntime)
    'SMS_PROVIDER',
    'MEDIA_STORAGE_PROVIDER'
  ]);

  // Payment, SMS, and media storage: selector-based required keys
  for (const [providerKey, providerMap] of Object.entries(OPS_CONFIG_REQUIRED_BY_PROVIDER)) {
    const hasExplicitProvider = (draftEnv[providerKey] ?? '').trim().length > 0;
    if (!hasExplicitProvider) {
      continue;
    }
    const providerValue = getProviderValue(draftEnv, providerKey);
    for (const key of providerMap[providerValue] ?? []) {
      required.add(key);
    }
  }

  // Shipping: credential-presence-based (mirrors resolveDualShippingRuntime detection logic)
  const hasDelhiveryCreds = Boolean((draftEnv['DELHIVERY_API_KEY'] ?? '').trim());
  const hasPartialShiprocket =
    Boolean((draftEnv['SHIPROCKET_EMAIL'] ?? '').trim()) ||
    Boolean((draftEnv['SHIPROCKET_PASSWORD'] ?? '').trim());
  if (hasPartialShiprocket) {
    // If operator has started configuring Shiprocket, require all activation credentials
    required.add('SHIPROCKET_EMAIL');
    required.add('SHIPROCKET_PASSWORD');
    required.add('SHIPROCKET_PICKUP_PINCODE');
    required.add('SHIPROCKET_PICKUP_LOCATION');
  }

  for (const [flagKey, keys] of Object.entries(OPS_CONFIG_REQUIRED_BY_FLAG)) {
    if (isEnabled(draftEnv[flagKey])) {
      for (const key of keys) {
        required.add(key);
      }
    }
  }

  if (strictProfile) {
    for (const key of OPS_CONFIG_STRICT_BASE_REQUIRED) {
      required.add(key);
    }

    // Payment strict requirements (selector-based)
    for (const [providerKey, strictMap] of Object.entries(OPS_CONFIG_STRICT_ADDITIONAL_REQUIRED_BY_PROVIDER)) {
      const hasExplicitProvider = (draftEnv[providerKey] ?? '').trim().length > 0;
      if (!hasExplicitProvider) {
        continue;
      }
      const providerValue = getProviderValue(draftEnv, providerKey);
      for (const key of strictMap[providerValue] ?? []) {
        required.add(key);
      }
    }

    // Shipping strict: webhook requirements per credential-active provider
    if (hasDelhiveryCreds) {
      required.add('DELHIVERY_WEBHOOK_TOKEN');
      required.add('SHIPPING_WEBHOOK_ALLOWLIST_CIDR');
    }
    if (hasPartialShiprocket) {
      required.add('SHIPROCKET_WEBHOOK_TOKEN');
      required.add('SHIPPING_WEBHOOK_ALLOWLIST_CIDR');
    }
  }

  return [...required];
}

export function findMissingStrictOpsConfigKeys(draftEnv: NodeJS.ProcessEnv): string[] {
  return computeRequiredOpsConfigKeys(draftEnv, true).filter((key) => !(draftEnv[key] ?? '').trim());
}
