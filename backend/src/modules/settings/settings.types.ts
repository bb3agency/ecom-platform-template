export type UpdateShippingSettingsInput = {
  pickupPincode: string;
  minOrderValuePaise: number;
};

export type ShippingProviderAvailability = {
  delhiveryConfigured: boolean;
  shiprocketConfigured: boolean;
  hasAnyProvider: boolean;
};

export type ShippingSettingsResponse = {
  pickupPincode: string;
  minOrderValuePaise: number;
  source: 'database' | 'environment' | 'default';
  providerAvailability: ShippingProviderAvailability;
};

export type StoreProfileResponse = {
  storeName: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  gstin: string | null;
  fssaiNumber: string | null;
  sellerLegalName: string | null;
  sellerAddress: string | null;
  sellerState: string | null;
};

export type UpdateStoreProfileInput = {
  storeName?: string;
  websiteUrl?: string;
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  gstin?: string;
  fssaiNumber?: string;
  sellerLegalName?: string;
  sellerAddress?: string;
  sellerState?: string | null;
};

/**
 * Ops-layer provider provisioning status.
 * Computed from NOTIFY_*_ENABLED flags + presence of provider API keys
 * resolved through resolveNotificationRuntimeConfig() (env + OpsConfigSecret overlay).
 * Booleans only — no key values exposed to admin layer.
 */
export type ProviderAvailability = {
  /** true = NOTIFY_EMAIL_ENABLED is true AND RESEND_API_KEY is set */
  emailProvisioned: boolean;
  /** true = NOTIFY_SMS_ENABLED is true AND the active SMS provider's key is set */
  smsProvisioned: boolean;
  /** true = NOTIFY_WHATSAPP_ENABLED is true AND META_WHATSAPP_* keys are set */
  whatsappProvisioned: boolean;
  /** true = OTP_WHATSAPP_ENABLED is on: signup/login OTP is ALSO sent over WhatsApp (in addition to the primary channel) */
  otpWhatsappEnabled: boolean;
  /** Which SMS provider is active when smsProvisioned=true; null if not provisioned */
  smsProvider: 'msg91' | 'fast2sms' | 'noop' | null;
};

export type NotificationSettingsResponse = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  /** Per-template SET of delivery channels (multi-channel). A notification fans out to all of them. */
  primaryChannels: Record<string, PrimaryNotificationChannel[]>;
  smsTemplates: Record<string, string>;
  /** Ops-layer provider availability. Read-only for admin; mutated only via /ops/config. */
  providerAvailability: ProviderAvailability;
};

export type NotificationFlags = Pick<NotificationSettingsResponse, 'emailEnabled' | 'smsEnabled' | 'whatsappEnabled'>;

export type UpdateNotificationSettingsInput = {
  emailEnabled?: boolean;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
  /** Accepts a single channel (legacy) or an array (multi-channel) per template. */
  primaryChannels?: Record<string, PrimaryNotificationChannel | PrimaryNotificationChannel[]>;
  smsTemplates?: Record<string, string>;
};

export type PrimaryNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export type InventorySettingsResponse = {
  defaultLowStockThreshold: number;
};

export type UpdateInventorySettingsInput = {
  defaultLowStockThreshold: number;
};

export type BoxPreset = {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type BoxPresetsResponse = {
  presets: BoxPreset[];
};
