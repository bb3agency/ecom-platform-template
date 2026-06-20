function getBoolEnv(name: string, fallback = false, env: Record<string, string | undefined> = process.env): boolean {
  const value = env[name];
  if (!value) {
    return fallback;
  }
  return value.toLowerCase() === 'true';
}

export function resolveFeatureFlags() {
  return {
    coupons: getBoolEnv('FEATURE_COUPONS_ENABLED', false),
    reviews: getBoolEnv('FEATURE_REVIEWS_ENABLED', false),
    wishlist: getBoolEnv('FEATURE_WISHLIST_ENABLED', false),
    gstInvoicing: getBoolEnv('FEATURE_GST_INVOICING_ENABLED', false),
    responseEnvelope: getBoolEnv('FEATURE_RESPONSE_ENVELOPE_ENABLED', false)
  };
}

export const featureFlags = resolveFeatureFlags();

export function refreshFeatureFlags(): void {
  Object.assign(featureFlags, resolveFeatureFlags());
  Object.assign(notifyFlags, resolveNotifyFlags());
}

export function resolveNotifyFlags(env: Record<string, string | undefined> = process.env) {
  return {
    email: getBoolEnv('NOTIFY_EMAIL_ENABLED', true, env),
    sms: getBoolEnv('NOTIFY_SMS_ENABLED', false, env),
    whatsapp: getBoolEnv('NOTIFY_WHATSAPP_ENABLED', false, env)
  };
}

export const notifyFlags = resolveNotifyFlags();

