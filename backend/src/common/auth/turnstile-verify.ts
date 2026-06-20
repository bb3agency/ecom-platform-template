import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { isTurnstileVerificationEnabled } from './auth-turnstile';

/**
 * Verifies a Cloudflare Turnstile token when enforcement is active.
 * No-op when Turnstile is disabled (local dev without TURNSTILE_ENFORCE_IN_DEV).
 */
export async function assertTurnstileToken(args: {
  turnstileToken?: string;
  clientIp?: string;
}): Promise<void> {
  if (!isTurnstileVerificationEnabled()) {
    return;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return;
  }

  const token = args.turnstileToken?.trim();
  if (!token) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Challenge token is required', 400);
  }

  const clientIp = args.clientIp?.trim();
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret,
      response: token,
      ...(clientIp ? { remoteip: clientIp } : {})
    }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Challenge verification is unavailable', 502);
  }

  const payload = (await response.json()) as { success?: boolean };
  if (!payload.success) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Challenge verification failed', 400);
  }
}
