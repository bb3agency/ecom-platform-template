import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertAdminPolicyRegistryIntegrity } from './admin-policy-registry.validation';

describe('admin policy registry integrity', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('has unique endpoint keys and matching permission layers (src/modules)', () => {
    expect(() => assertAdminPolicyRegistryIntegrity()).not.toThrow();
  });

  it('has unique endpoint keys and matching permission layers (dist/src/modules)', () => {
    const distModules = path.join(process.cwd(), 'dist', 'src', 'modules');
    if (!fs.existsSync(distModules)) {
      return;
    }
    process.env.NODE_ENV = 'production';
    expect(() => assertAdminPolicyRegistryIntegrity()).not.toThrow();
  });
});
