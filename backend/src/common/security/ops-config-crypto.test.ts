import { afterEach, describe, expect, it } from 'vitest';
import { encryptOpsConfigValue } from './ops-config-crypto';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('ops config crypto', () => {
  it('fails closed when OPS_DB_ENCRYPTION_KEY is missing', () => {
    delete process.env.OPS_DB_ENCRYPTION_KEY;
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';

    expect(() => encryptOpsConfigValue('secret')).toThrow('OPS_DB_ENCRYPTION_KEY is not configured');
  });

  it('does not fall back to other secrets', () => {
    process.env.OPS_DB_ENCRYPTION_KEY = '';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';

    expect(() => encryptOpsConfigValue('secret')).toThrow('OPS_DB_ENCRYPTION_KEY is not configured');
  });
});
