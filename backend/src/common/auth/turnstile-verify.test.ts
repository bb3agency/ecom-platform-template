import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertTurnstileToken } from './turnstile-verify';

describe('assertTurnstileToken', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('no-ops when Turnstile is not enforced', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_ENFORCE_IN_DEV', '');
    await expect(assertTurnstileToken({})).resolves.toBeUndefined();
  });

  it('requires token when enforced in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    await expect(assertTurnstileToken({})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  });
});
