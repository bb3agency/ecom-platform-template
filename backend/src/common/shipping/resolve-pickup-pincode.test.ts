import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as opsCrypto from '@common/security/ops-config-crypto';
import { resolvePickupPincode } from './resolve-pickup-pincode';

describe('resolvePickupPincode', () => {
  beforeEach(() => {
    delete process.env.SHIPROCKET_PICKUP_PINCODE;
    delete process.env.DELHIVERY_PICKUP_PINCODE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('prefers storeSettings pickup pincode over env and ops overlay', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '560001');
    const prisma = {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue({ pickupPincode: '500001' })
      },
      opsConfigSecret: {
        findMany: vi.fn()
      }
    };

    const pincode = await resolvePickupPincode(prisma);

    expect(pincode).toBe('500001');
    expect(prisma.opsConfigSecret.findMany).not.toHaveBeenCalled();
  });

  it('prefers SHIPROCKET_PICKUP_PINCODE over DELHIVERY when both env vars are set', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '560001');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    const prisma = {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    };

    const pincode = await resolvePickupPincode(prisma);

    expect(pincode).toBe('560001');
  });

  it('reads pickup pincode from ops overlay when env is unset', async () => {
    vi.spyOn(opsCrypto, 'decryptOpsConfigValue').mockReturnValue('522006');
    const prisma = {
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
    };

    const pincode = await resolvePickupPincode(prisma);

    expect(pincode).toBe('522006');
  });

  it('returns noop fallback when no pincode is configured', async () => {
    const prisma = {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    };

    const pincode = await resolvePickupPincode(prisma, { noopFallback: '500001' });

    expect(pincode).toBe('500001');
  });
});
