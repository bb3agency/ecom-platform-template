import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as opsCrypto from '@common/security/ops-config-crypto';
import { SettingsService } from './settings.service';



describe('SettingsService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });  it('returns database pickup pincode when persisted setting exists', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            pickupPincode: '500001',
            minOrderValuePaise: 15000
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getShippingSettings()).resolves.toMatchObject({
      pickupPincode: '500001',
      minOrderValuePaise: 15000,
      source: 'database'
    });
  });

  it('returns template defaults when shipping is not configured yet', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '');
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getShippingSettings()).resolves.toMatchObject({
      pickupPincode: '500001',
      minOrderValuePaise: 0,
      source: 'default'
    });
  });

  it('prefers SHIPROCKET_PICKUP_PINCODE over DELHIVERY from environment', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '560001');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getShippingSettings()).resolves.toMatchObject({
      pickupPincode: '560001',
      minOrderValuePaise: 0,
      source: 'environment'
    });
  });

  it('reads pickup pincode from ops overlay when env is unset', async () => {
    vi.spyOn(opsCrypto, 'decryptOpsConfigValue').mockReturnValue('522006');
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue(null)
        },
        opsConfigSecret: {
          findMany: vi.fn().mockResolvedValue([
            {
              secretKey: 'DELHIVERY_PICKUP_PINCODE',
              encryptedValue: 'encrypted-value'
            }
          ])
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getShippingSettings()).resolves.toMatchObject({
      pickupPincode: '522006',
      minOrderValuePaise: 0,
      source: 'environment'
    });
  });

  it('seeds pickup pincode from ops overlay when creating store settings row', async () => {
    vi.spyOn(opsCrypto, 'decryptOpsConfigValue').mockReturnValue('522006');
    const upsert = vi.fn().mockResolvedValue({
      isCodEnabled: true,
      mobileOtpSignupEnabled: false,
      cancellationWindowHours: 24,
      sellerState: null
    });
    const fastify = {
      prisma: {
        storeSettings: {
          upsert,
          findUnique: vi.fn().mockResolvedValue(null)
        },
        opsConfigSecret: {
          findMany: vi.fn().mockResolvedValue([
            {
              secretKey: 'DELHIVERY_PICKUP_PINCODE',
              encryptedValue: 'encrypted-value'
            }
          ])
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await service.updateCodSettings({ isCodEnabled: true });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ pickupPincode: '522006' })
      })
    );
  });

  it('updates pickup pincode through singleton upsert', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          upsert: vi.fn().mockResolvedValue({
            pickupPincode: '560001',
            minOrderValuePaise: 12000
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.updateShippingSettings({ pickupPincode: '560001', minOrderValuePaise: 12000 })).resolves.toMatchObject({
      pickupPincode: '560001',
      minOrderValuePaise: 12000,
      source: 'database'
    });
  });
});

describe('SettingsService — COD settings', () => {
  it('getCodSettings returns stored values', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            isCodEnabled: true,
            cancellationWindowHours: 48,
            sellerState: 'Telangana'
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);
    const result = await service.getCodSettings();
    expect(result.isCodEnabled).toBe(true);
    expect(result.cancellationWindowHours).toBe(48);
    expect(result.sellerState).toBe('Telangana');
    expect(result.mobileOtpSignupEnabled).toBe(false);
  });

  it('getCodSettings returns safe defaults when no record exists', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);
    const result = await service.getCodSettings();
    expect(result.isCodEnabled).toBe(false);
    expect(result.cancellationWindowHours).toBe(24);
    expect(result.sellerState).toBeNull();
    expect(result.mobileOtpSignupEnabled).toBe(false);
  });

  it('updateCodSettings upserts with provided values', async () => {
    const upsertMock = vi.fn().mockResolvedValue({
      isCodEnabled: true,
      cancellationWindowHours: 12,
      sellerState: 'Karnataka'
    });
    const fastify = {
      prisma: {
        storeSettings: {
          upsert: upsertMock,
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);
    const result = await service.updateCodSettings({ isCodEnabled: true, cancellationWindowHours: 12, sellerState: 'Karnataka' });
    expect(result.isCodEnabled).toBe(true);
    expect(result.cancellationWindowHours).toBe(12);
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it('updateCodSettings enforces minimum cancellationWindowHours of 1', async () => {
    const upsertMock = vi.fn().mockResolvedValue({
      isCodEnabled: false,
      cancellationWindowHours: 1,
      sellerState: null
    });
    const fastify = {
      prisma: {
        storeSettings: {
          upsert: upsertMock,
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);
    await service.updateCodSettings({ cancellationWindowHours: 0 }); // 0 should be floored to 1
    const upsertArg = upsertMock.mock.calls[0]?.[0] as { update: Record<string, unknown> } | undefined;
    expect(upsertArg?.update['cancellationWindowHours']).toBe(1);
  });
});

describe('SettingsService — store profile seller fields', () => {
  it('returns seller compliance fields from database', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            storeName: 'Acme',
            websiteUrl: 'https://acme.example.com',
            logoUrl: null,
            contactEmail: null,
            contactPhone: null,
            gstin: '29AAAAA1111A1Z1',
            fssaiNumber: '12345678901234',
            sellerLegalName: 'Acme Foods Pvt Ltd',
            sellerAddress: '123 Market Road',
            sellerState: 'Telangana'
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getStoreProfile()).resolves.toEqual(
      expect.objectContaining({
        sellerLegalName: 'Acme Foods Pvt Ltd',
        sellerAddress: '123 Market Road',
        sellerState: 'Telangana'
      })
    );
  });

  it('updates seller compliance fields through singleton upsert', async () => {
    const upsertMock = vi.fn().mockResolvedValue({
      storeName: null,
      websiteUrl: null,
      logoUrl: null,
      contactEmail: null,
      contactPhone: null,
      gstin: '29AAAAA1111A1Z1',
      fssaiNumber: '12345678901234',
      sellerLegalName: 'Acme Foods Pvt Ltd',
      sellerAddress: '123 Market Road',
      sellerState: 'Telangana'
    });
    const fastify = {
      prisma: {
        storeSettings: {
          upsert: upsertMock,
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(
      service.updateStoreProfile({
        sellerLegalName: 'Acme Foods Pvt Ltd',
        sellerAddress: '123 Market Road',
        sellerState: 'Telangana'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        sellerLegalName: 'Acme Foods Pvt Ltd',
        sellerAddress: '123 Market Road',
        sellerState: 'Telangana'
      })
    );
  });
});
