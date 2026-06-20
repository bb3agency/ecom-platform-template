import { afterEach, describe, expect, it } from 'vitest';
import { encryptOpsConfigValue } from '@common/security/ops-config-crypto';
import { applyOpsConfigRuntimeOverlay } from './ops-config-runtime';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function prismaWithRows(rows: Array<{ secretKey: string; encryptedValue: string; isActive?: boolean }>) {
  return {
    opsConfigSecret: {
      findMany: async () => rows
    }
  };
}

describe('applyOpsConfigRuntimeOverlay', () => {
  it('applies DB values over env for runtime overlay keys', async () => {
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-overlay-key';
    process.env.RAZORPAY_KEY_ID = 'env_value';

    const report = await applyOpsConfigRuntimeOverlay(prismaWithRows([
      { secretKey: 'RAZORPAY_KEY_ID', encryptedValue: encryptOpsConfigValue('db_value') }
    ]));

    expect(process.env.RAZORPAY_KEY_ID).toBe('db_value');
    expect(report.appliedKeys).toEqual(['RAZORPAY_KEY_ID']);
  });

  it('skips bootstrap keys even when present in DB', async () => {
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-overlay-key';
    process.env.DATABASE_URL = 'postgres://env';

    const report = await applyOpsConfigRuntimeOverlay(prismaWithRows([
      { secretKey: 'DATABASE_URL', encryptedValue: encryptOpsConfigValue('postgres://db') },
      { secretKey: 'REDIS_URL', encryptedValue: encryptOpsConfigValue('redis://db') },
      { secretKey: 'OPS_DB_ENCRYPTION_KEY', encryptedValue: encryptOpsConfigValue('db-key') }
    ]));

    expect(process.env.DATABASE_URL).toBe('postgres://env');
    expect(report.skippedBootstrapKeys).toEqual(['DATABASE_URL', 'REDIS_URL', 'OPS_DB_ENCRYPTION_KEY']);
    expect(report.appliedKeys).toEqual([]);
  });

  it('skips unknown keys', async () => {
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-overlay-key';

    const report = await applyOpsConfigRuntimeOverlay(prismaWithRows([
      { secretKey: 'UNKNOWN_SECRET', encryptedValue: encryptOpsConfigValue('value') }
    ]));

    expect(process.env.UNKNOWN_SECRET).toBeUndefined();
    expect(report.skippedUnknownKeys).toEqual(['UNKNOWN_SECRET']);
  });

  it('skips NODE_ENV and CLIENT_ID even when present in DB (not overlay keys)', async () => {
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-overlay-key';
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ID = 'original-client';

    const report = await applyOpsConfigRuntimeOverlay(prismaWithRows([
      { secretKey: 'NODE_ENV', encryptedValue: encryptOpsConfigValue('development') },
      { secretKey: 'CLIENT_ID', encryptedValue: encryptOpsConfigValue('hacked-client') }
    ]));

    expect(process.env.NODE_ENV).toBe('production');
    expect(process.env.CLIENT_ID).toBe('original-client');
    expect(report.skippedUnknownKeys).toEqual(['NODE_ENV', 'CLIENT_ID']);
    expect(report.appliedKeys).toEqual([]);
  });

  it('records decrypt failures in development-like runtime without applying value', async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-overlay-key';
    delete process.env.RAZORPAY_KEY_ID;

    const report = await applyOpsConfigRuntimeOverlay(prismaWithRows([
      { secretKey: 'RAZORPAY_KEY_ID', encryptedValue: 'malformed' }
    ]));

    expect(process.env.RAZORPAY_KEY_ID).toBeUndefined();
    expect(report.failedKeys).toEqual(['RAZORPAY_KEY_ID']);
  });
});
