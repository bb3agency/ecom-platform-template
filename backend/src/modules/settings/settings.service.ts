import { FastifyInstance } from 'fastify';
import { isStorefrontCouponsEnabled } from '@common/coupons/coupons-feature';
import { featureFlags } from '@config/feature-flags';
import { resolveNotificationRuntimeConfig } from '@common/notifications/notification-runtime-config';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';
import { resolveDualShippingRuntime } from '@modules/shipping/shipping-provider';
import { SmsTemplateRegistry } from '@modules/notifications/sms-template-registry';
import { supportedEmailTemplates } from '@modules/notifications/templates/email-templates';
import {
  BoxPreset,
  BoxPresetsResponse,
  InventorySettingsResponse,
  NotificationFlags,
  NotificationSettingsResponse,
  PrimaryNotificationChannel,
  ProviderAvailability,
  ShippingSettingsResponse,
  StoreProfileResponse,
  UpdateInventorySettingsInput,
  UpdateNotificationSettingsInput,
  UpdateShippingSettingsInput,
  UpdateStoreProfileInput
} from './settings.types';
import { parseBoxPresets } from '@common/shipping/select-box-preset';

export class SettingsService {
  private static readonly singletonKey = 'default';
  private static readonly defaultPrimaryChannel: PrimaryNotificationChannel = 'EMAIL';
  /** Matches upsert create fallback in updateStoreProfile / updateShippingSettings. */
  private static readonly defaultPickupPincode = '500001';

  constructor(private readonly fastify: FastifyInstance) {}

  private async resolveDefaultPickupPincodeForCreate(): Promise<string> {
    return (
      (await resolvePickupPincode(this.fastify.prisma, {
        noopFallback: SettingsService.defaultPickupPincode
      })) ?? SettingsService.defaultPickupPincode
    );
  }

  /**
   * Resolves ops-layer provider availability without exposing any key values.
   * Returns boolean flags only — safe to include in admin API responses.
   */
  private async resolveProviderAvailability(): Promise<ProviderAvailability> {
    try {
      const runtimeConfig = await resolveNotificationRuntimeConfig(this.fastify.prisma);
      const flagEnabled = (key: string, fallback: boolean): boolean => {
        const v = (runtimeConfig[key] ?? '').trim().toLowerCase();
        return v === '' ? fallback : v === 'true';
      };

      const emailEnabled = flagEnabled('NOTIFY_EMAIL_ENABLED', true);
      const smsEnabled = flagEnabled('NOTIFY_SMS_ENABLED', false);
      const whatsappEnabled = flagEnabled('NOTIFY_WHATSAPP_ENABLED', false);
      const smsProvider = ((runtimeConfig.SMS_PROVIDER ?? 'msg91').trim().toLowerCase()) as 'msg91' | 'fast2sms' | 'noop';

      const emailProvisioned =
        emailEnabled && !!(runtimeConfig.RESEND_API_KEY ?? '').trim();

      const smsKeyPresent =
        smsProvider === 'noop' ? true :
        smsProvider === 'msg91' ? !!(runtimeConfig.MSG91_AUTH_KEY ?? '').trim() :
        smsProvider === 'fast2sms' ? !!(runtimeConfig.FAST2SMS_API_KEY ?? '').trim() :
        false;
      const smsProvisioned = smsEnabled && smsKeyPresent;

      const whatsappProvisioned =
        whatsappEnabled &&
        !!(runtimeConfig.META_WHATSAPP_ACCESS_TOKEN ?? '').trim() &&
        !!(runtimeConfig.META_WHATSAPP_PHONE_NUMBER_ID ?? '').trim();

      const otpWhatsappEnabled = whatsappProvisioned && flagEnabled('OTP_WHATSAPP_ENABLED', false);

      return {
        emailProvisioned,
        smsProvisioned,
        whatsappProvisioned,
        otpWhatsappEnabled,
        smsProvider: smsProvisioned ? smsProvider : null
      };
    } catch {
      // If runtime config resolution fails (e.g. DB not reachable), assume unprovisioned
      return {
        emailProvisioned: false,
        smsProvisioned: false,
        whatsappProvisioned: false,
        otpWhatsappEnabled: false,
        smsProvider: null
      };
    }
  }

  /** Coerce a stored/input value (single `'EMAIL'` OR array `['EMAIL','WHATSAPP']`) to a deduped channel array. */
  private static normalizeChannelArray(raw: unknown): PrimaryNotificationChannel[] {
    const arr = Array.isArray(raw) ? raw : [raw];
    const out: PrimaryNotificationChannel[] = [];
    for (const v of arr) {
      if ((v === 'EMAIL' || v === 'SMS' || v === 'WHATSAPP') && !out.includes(v)) {
        out.push(v);
      }
    }
    return out;
  }

  private normalizePrimaryChannels(value: unknown): Record<string, PrimaryNotificationChannel[]> {
    const defaults = Object.fromEntries(
      supportedEmailTemplates.map((template) => [template, [SettingsService.defaultPrimaryChannel]])
    ) as Record<string, PrimaryNotificationChannel[]>;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return defaults;
    }

    const normalized: Record<string, PrimaryNotificationChannel[]> = { ...defaults };
    for (const [template, channelRaw] of Object.entries(value as Record<string, unknown>)) {
      if (!supportedEmailTemplates.includes(template as (typeof supportedEmailTemplates)[number])) {
        continue;
      }
      const list = SettingsService.normalizeChannelArray(channelRaw);
      // Never store an empty set — fall back to the default channel so a notification always has a
      // route (merchants fully disable a channel type via the master NOTIFY_*_ENABLED toggles).
      normalized[template] = list.length > 0 ? list : [SettingsService.defaultPrimaryChannel];
    }

    return normalized;
  }

  private resolveShippingProviderAvailability() {
    const runtime = resolveDualShippingRuntime();
    return {
      delhiveryConfigured: runtime.delhivery !== null,
      shiprocketConfigured: runtime.shiprocket !== null,
      hasAnyProvider: runtime.hasAny
    };
  }

  async getShippingSettings(): Promise<ShippingSettingsResponse> {
    const providerAvailability = this.resolveShippingProviderAvailability();
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: SettingsService.singletonKey },
      select: { pickupPincode: true, minOrderValuePaise: true, defaultLowStockThreshold: true }
    });

    if (settings) {
      return { pickupPincode: settings.pickupPincode, minOrderValuePaise: settings.minOrderValuePaise, source: 'database', providerAvailability };
    }

    const resolved = await resolvePickupPincode(this.fastify.prisma, { noopFallback: null });
    if (resolved && resolved.length === 6) {
      return { pickupPincode: resolved, minOrderValuePaise: 0, source: 'environment', providerAvailability };
    }

    return { pickupPincode: SettingsService.defaultPickupPincode, minOrderValuePaise: 0, source: 'default', providerAvailability };
  }

  async updateShippingSettings(input: UpdateShippingSettingsInput): Promise<ShippingSettingsResponse> {
    const pickupPincode = input.pickupPincode.trim();
    const minOrderValuePaise = Math.floor(input.minOrderValuePaise);
    const updated = await this.fastify.prisma.storeSettings.upsert({
      where: { singletonKey: SettingsService.singletonKey },
      update: { pickupPincode, minOrderValuePaise },
      create: {
        singletonKey: SettingsService.singletonKey,
        pickupPincode,
        minOrderValuePaise,
        defaultLowStockThreshold: 5
      },
      select: { pickupPincode: true, minOrderValuePaise: true }
    });

    return {
      pickupPincode: updated.pickupPincode,
      minOrderValuePaise: updated.minOrderValuePaise,
      source: 'database',
      providerAvailability: this.resolveShippingProviderAvailability()
    };
  }

  async getStoreProfile(): Promise<StoreProfileResponse> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: SettingsService.singletonKey },
      select: {
        storeName: true,
        websiteUrl: true,
        logoUrl: true,
        contactEmail: true,
        contactPhone: true,
        gstin: true,
        fssaiNumber: true,
        sellerLegalName: true,
        sellerAddress: true,
        sellerState: true
      }
    });

    return {
      storeName: settings?.storeName ?? null,
      websiteUrl: settings?.websiteUrl ?? null,
      logoUrl: settings?.logoUrl ?? null,
      contactEmail: settings?.contactEmail ?? null,
      contactPhone: settings?.contactPhone ?? null,
      gstin: settings?.gstin ?? null,
      fssaiNumber: settings?.fssaiNumber ?? null,
      sellerLegalName: settings?.sellerLegalName ?? null,
      sellerAddress: settings?.sellerAddress ?? null,
      sellerState: settings?.sellerState ?? null
    };
  }

  async updateStoreProfile(input: UpdateStoreProfileInput): Promise<StoreProfileResponse> {
    const defaultPickupPincode = await this.resolveDefaultPickupPincodeForCreate();
    const updated = await this.fastify.prisma.storeSettings.upsert({
      where: { singletonKey: SettingsService.singletonKey },
      update: {
        ...(input.storeName !== undefined ? { storeName: input.storeName } : {}),
        ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
        ...(input.fssaiNumber !== undefined ? { fssaiNumber: input.fssaiNumber } : {}),
        ...(input.sellerLegalName !== undefined ? { sellerLegalName: input.sellerLegalName } : {}),
        ...(input.sellerAddress !== undefined ? { sellerAddress: input.sellerAddress } : {}),
        ...(input.sellerState !== undefined ? { sellerState: input.sellerState } : {})
      },
      create: {
        singletonKey: SettingsService.singletonKey,
        pickupPincode: defaultPickupPincode,
        defaultLowStockThreshold: 5,
        ...(input.storeName !== undefined ? { storeName: input.storeName } : {}),
        ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
        ...(input.fssaiNumber !== undefined ? { fssaiNumber: input.fssaiNumber } : {}),
        ...(input.sellerLegalName !== undefined ? { sellerLegalName: input.sellerLegalName } : {}),
        ...(input.sellerAddress !== undefined ? { sellerAddress: input.sellerAddress } : {}),
        ...(input.sellerState !== undefined ? { sellerState: input.sellerState } : {})
      },
      select: {
        storeName: true,
        websiteUrl: true,
        logoUrl: true,
        contactEmail: true,
        contactPhone: true,
        gstin: true,
        fssaiNumber: true,
        sellerLegalName: true,
        sellerAddress: true,
        sellerState: true
      }
    });

    return {
      storeName: updated.storeName,
      websiteUrl: updated.websiteUrl,
      logoUrl: updated.logoUrl,
      contactEmail: updated.contactEmail,
      contactPhone: updated.contactPhone,
      gstin: updated.gstin,
      fssaiNumber: updated.fssaiNumber,
      sellerLegalName: updated.sellerLegalName,
      sellerAddress: updated.sellerAddress,
      sellerState: updated.sellerState
    };
  }

  async getNotificationSettings(): Promise<NotificationSettingsResponse> {
    const [settings, providerAvailability] = await Promise.all([
      this.fastify.prisma.storeSettings.findUnique({
        where: { singletonKey: SettingsService.singletonKey },
        select: {
          notifyEmailEnabled: true,
          notifySmsEnabled: true,
          notifyWhatsappEnabled: true,
          primaryNotificationChannels: true,
          smsTemplates: true
        }
      }),
      this.resolveProviderAvailability()
    ]);

    return {
      emailEnabled: settings?.notifyEmailEnabled ?? true,
      smsEnabled: settings?.notifySmsEnabled ?? false,
      whatsappEnabled: settings?.notifyWhatsappEnabled ?? false,
      primaryChannels: this.normalizePrimaryChannels(settings?.primaryNotificationChannels),
      smsTemplates: SmsTemplateRegistry.normalizeTemplateOverrides(settings?.smsTemplates),
      providerAvailability
    };
  }

  async updateNotificationSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettingsResponse> {
    const normalizedSmsTemplates =
      input.smsTemplates !== undefined ? SmsTemplateRegistry.normalizeTemplateOverrides(input.smsTemplates) : undefined;
    const defaultPickupPincode = await this.resolveDefaultPickupPincodeForCreate();

    const updated = await this.fastify.prisma.storeSettings.upsert({
      where: { singletonKey: SettingsService.singletonKey },
      update: {
        ...(input.emailEnabled !== undefined ? { notifyEmailEnabled: input.emailEnabled } : {}),
        ...(input.smsEnabled !== undefined ? { notifySmsEnabled: input.smsEnabled } : {}),
        ...(input.whatsappEnabled !== undefined ? { notifyWhatsappEnabled: input.whatsappEnabled } : {}),
        ...(input.primaryChannels !== undefined
          ? { primaryNotificationChannels: this.normalizePrimaryChannels(input.primaryChannels) }
          : {}),
        ...(normalizedSmsTemplates !== undefined ? { smsTemplates: normalizedSmsTemplates } : {})
      },
      create: {
        singletonKey: SettingsService.singletonKey,
        pickupPincode: defaultPickupPincode,
        defaultLowStockThreshold: 5,
        ...(input.emailEnabled !== undefined ? { notifyEmailEnabled: input.emailEnabled } : {}),
        ...(input.smsEnabled !== undefined ? { notifySmsEnabled: input.smsEnabled } : {}),
        ...(input.whatsappEnabled !== undefined ? { notifyWhatsappEnabled: input.whatsappEnabled } : {}),
        ...(input.primaryChannels !== undefined
          ? { primaryNotificationChannels: this.normalizePrimaryChannels(input.primaryChannels) }
          : { primaryNotificationChannels: this.normalizePrimaryChannels(undefined) }),
        ...(normalizedSmsTemplates !== undefined ? { smsTemplates: normalizedSmsTemplates } : {})
      },
      select: {
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        notifyWhatsappEnabled: true,
        primaryNotificationChannels: true,
        smsTemplates: true
      }
    });

    const providerAvailability = await this.resolveProviderAvailability();

    return {
      emailEnabled: updated.notifyEmailEnabled,
      smsEnabled: updated.notifySmsEnabled,
      whatsappEnabled: updated.notifyWhatsappEnabled,
      primaryChannels: this.normalizePrimaryChannels(updated.primaryNotificationChannels),
      smsTemplates: SmsTemplateRegistry.normalizeTemplateOverrides(updated.smsTemplates),
      providerAvailability
    };
  }

  async resolveNotificationFlags(): Promise<NotificationFlags> {
    try {
      const settings = await this.fastify.prisma.storeSettings.findUnique({
        where: { singletonKey: SettingsService.singletonKey },
        select: {
          notifyEmailEnabled: true,
          notifySmsEnabled: true,
          notifyWhatsappEnabled: true
        }
      });

      return {
        emailEnabled: settings?.notifyEmailEnabled ?? (process.env.NOTIFY_EMAIL_ENABLED ?? 'true').toLowerCase() === 'true',
        smsEnabled: settings?.notifySmsEnabled ?? (process.env.NOTIFY_SMS_ENABLED ?? 'false').toLowerCase() === 'true',
        whatsappEnabled:
          settings?.notifyWhatsappEnabled ?? (process.env.NOTIFY_WHATSAPP_ENABLED ?? 'false').toLowerCase() === 'true'
      };
    } catch {
      return {
        emailEnabled: (process.env.NOTIFY_EMAIL_ENABLED ?? 'true').toLowerCase() === 'true',
        smsEnabled: (process.env.NOTIFY_SMS_ENABLED ?? 'false').toLowerCase() === 'true',
        whatsappEnabled: (process.env.NOTIFY_WHATSAPP_ENABLED ?? 'false').toLowerCase() === 'true'
      };
    }
  }

  async getInventorySettings(): Promise<InventorySettingsResponse> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: SettingsService.singletonKey },
      select: {
        defaultLowStockThreshold: true
      }
    });

    return {
      defaultLowStockThreshold: settings?.defaultLowStockThreshold ?? 5
    };
  }

  async updateInventorySettings(input: UpdateInventorySettingsInput): Promise<InventorySettingsResponse> {
    const threshold = Math.floor(input.defaultLowStockThreshold);
    const defaultPickupPincode = await this.resolveDefaultPickupPincodeForCreate();
    const updated = await this.fastify.prisma.storeSettings.upsert({
      where: { singletonKey: SettingsService.singletonKey },
      update: {
        defaultLowStockThreshold: threshold
      },
      create: {
        singletonKey: SettingsService.singletonKey,
        pickupPincode: defaultPickupPincode,
        defaultLowStockThreshold: threshold
      },
      select: {
        defaultLowStockThreshold: true
      }
    });

    return {
      defaultLowStockThreshold: updated.defaultLowStockThreshold
    };
  }

  async getCodSettings(): Promise<{ isCodEnabled: boolean; mobileOtpSignupEnabled: boolean; reviewsEnabled: boolean; returnsEnabled: boolean; cancellationWindowHours: number; sellerState: string | null }> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: SettingsService.singletonKey },
      select: { isCodEnabled: true, mobileOtpSignupEnabled: true, reviewsEnabled: true, returnsEnabled: true, cancellationWindowHours: true, sellerState: true }
    }) as { isCodEnabled: boolean; mobileOtpSignupEnabled: boolean; reviewsEnabled: boolean; returnsEnabled: boolean; cancellationWindowHours: number; sellerState: string | null } | null;
    return {
      isCodEnabled: settings?.isCodEnabled ?? false,
      mobileOtpSignupEnabled: settings?.mobileOtpSignupEnabled ?? false,
      reviewsEnabled: settings?.reviewsEnabled ?? false,
      returnsEnabled: settings?.returnsEnabled ?? true,
      cancellationWindowHours: settings?.cancellationWindowHours ?? 24,
      sellerState: settings?.sellerState ?? null
    };
  }

  async updateCodSettings(input: { isCodEnabled?: boolean; mobileOtpSignupEnabled?: boolean; reviewsEnabled?: boolean; returnsEnabled?: boolean; cancellationWindowHours?: number; sellerState?: string | null }): Promise<{ isCodEnabled: boolean; mobileOtpSignupEnabled: boolean; reviewsEnabled: boolean; returnsEnabled: boolean; cancellationWindowHours: number; sellerState: string | null }> {
    const updateData: Record<string, unknown> = {};
    if (input.isCodEnabled !== undefined) updateData['isCodEnabled'] = input.isCodEnabled;
    if (input.mobileOtpSignupEnabled !== undefined) updateData['mobileOtpSignupEnabled'] = input.mobileOtpSignupEnabled;
    if (input.reviewsEnabled !== undefined) updateData['reviewsEnabled'] = input.reviewsEnabled;
    if (input.returnsEnabled !== undefined) updateData['returnsEnabled'] = input.returnsEnabled;
    if (input.cancellationWindowHours !== undefined) updateData['cancellationWindowHours'] = Math.max(1, Math.floor(input.cancellationWindowHours));
    if (input.sellerState !== undefined) updateData['sellerState'] = input.sellerState;
    const defaultPickupPincode = await this.resolveDefaultPickupPincodeForCreate();

    const updated = await this.fastify.prisma.storeSettings.upsert({
      where: { singletonKey: SettingsService.singletonKey },
      update: updateData,
      create: {
        singletonKey: SettingsService.singletonKey,
        pickupPincode: defaultPickupPincode,
        defaultLowStockThreshold: 5,
        ...updateData
      },
      select: { isCodEnabled: true, mobileOtpSignupEnabled: true, reviewsEnabled: true, returnsEnabled: true, cancellationWindowHours: true, sellerState: true }
    }) as { isCodEnabled: boolean; mobileOtpSignupEnabled: boolean; reviewsEnabled: boolean; returnsEnabled: boolean; cancellationWindowHours: number; sellerState: string | null };
    return {
      isCodEnabled: updated.isCodEnabled ?? false,
      mobileOtpSignupEnabled: updated.mobileOtpSignupEnabled ?? false,
      reviewsEnabled: updated.reviewsEnabled ?? false,
      returnsEnabled: updated.returnsEnabled ?? true,
      cancellationWindowHours: updated.cancellationWindowHours ?? 24,
      sellerState: updated.sellerState ?? null
    };
  }

  async getBoxPresets(): Promise<BoxPresetsResponse> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: SettingsService.singletonKey },
      select: { boxPresets: true }
    });
    return { presets: parseBoxPresets(settings?.boxPresets) };
  }

  async updateBoxPresets(input: { presets: BoxPreset[] }): Promise<BoxPresetsResponse> {
    const defaultPickupPincode = await this.resolveDefaultPickupPincodeForCreate();
    const updated = await this.fastify.prisma.storeSettings.upsert({
      where: { singletonKey: SettingsService.singletonKey },
      update: { boxPresets: input.presets },
      create: {
        singletonKey: SettingsService.singletonKey,
        pickupPincode: defaultPickupPincode,
        defaultLowStockThreshold: 5,
        boxPresets: input.presets
      },
      select: { boxPresets: true }
    });
    return { presets: parseBoxPresets(updated.boxPresets) };
  }

  async resolveDefaultLowStockThreshold(): Promise<number> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: SettingsService.singletonKey },
      select: { defaultLowStockThreshold: true }
    });
    return settings?.defaultLowStockThreshold ?? 5;
  }

  /**
   * Public storefront configuration — no auth required.
   * Returns only the fields the customer-facing UI needs to render correctly.
   * Never exposes sensitive fields (GSTIN, contact details, notification keys).
   */
  async getPublicStoreConfig(): Promise<{
    isCodEnabled: boolean;
    minOrderValuePaise: number;
    mobileOtpSignupEnabled: boolean;
    couponsEnabled: boolean;
    reviewsEnabled: boolean;
    returnsEnabled: boolean;
    wishlistEnabled: boolean;
    gstInvoicingEnabled: boolean;
    storeName: string | null;
    storeAddress: string | null;
    storeState: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  }> {
    const [settings, couponsEnabled] = await Promise.all([
      this.fastify.prisma.storeSettings.findUnique({
        where: { singletonKey: SettingsService.singletonKey },
        select: {
          isCodEnabled: true,
          minOrderValuePaise: true,
          mobileOtpSignupEnabled: true,
          // Merchant reviews toggle (Admin → Settings) — drives storefront review UI.
          reviewsEnabled: true,
          // Merchant returns toggle (Admin → Settings) — gates the whole return-request flow.
          returnsEnabled: true,
          // Public store identity/contact — merchant-editable in Admin → Settings → Store,
          // rendered in the storefront footer + contact surfaces.
          storeName: true,
          sellerAddress: true,
          sellerState: true,
          contactEmail: true,
          contactPhone: true
        }
      }),
      isStorefrontCouponsEnabled(this.fastify.prisma)
    ]);
    return {
      isCodEnabled: settings?.isCodEnabled ?? false,
      minOrderValuePaise: settings?.minOrderValuePaise ?? 0,
      mobileOtpSignupEnabled: settings?.mobileOtpSignupEnabled ?? false,
      couponsEnabled,
      reviewsEnabled: settings?.reviewsEnabled ?? false,
      returnsEnabled: settings?.returnsEnabled ?? true,
      wishlistEnabled: featureFlags.wishlist,
      gstInvoicingEnabled: featureFlags.gstInvoicing,
      storeName: settings?.storeName ?? null,
      storeAddress: settings?.sellerAddress ?? null,
      storeState: settings?.sellerState ?? null,
      contactEmail: settings?.contactEmail ?? null,
      contactPhone: settings?.contactPhone ?? null
    };
  }
}
