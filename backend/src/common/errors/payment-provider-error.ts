import { AppError } from './app-error';
import { ERROR_CODES } from './error-codes';

/**
 * A payment provider answered with an error response. Carries the provider's
 * own code + description so workers can record WHY (e.g. "account does not
 * have enough balance") instead of a bare HTTP status.
 *
 * `rejected` = the provider understood the request and refused it (4xx). That
 * is a business answer, not an outage: retrying in seconds will not change it,
 * and it must not trip the provider circuit breaker.
 */
export class PaymentProviderError extends AppError {
  readonly provider: string;
  readonly httpStatus: number;
  readonly providerCode: string | null;
  readonly providerDescription: string | null;

  constructor(input: {
    provider: string;
    httpStatus: number;
    providerCode?: string | null;
    providerDescription?: string | null;
  }) {
    const description = input.providerDescription?.trim() || null;
    super(
      ERROR_CODES.INTERNAL_ERROR,
      `${input.provider} request failed: ${input.httpStatus}${description ? ` — ${description}` : ''}`,
      502
    );
    this.name = 'PaymentProviderError';
    this.provider = input.provider;
    this.httpStatus = input.httpStatus;
    this.providerCode = input.providerCode?.trim() || null;
    this.providerDescription = description;
  }

  get rejected(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500 && this.httpStatus !== 408 && this.httpStatus !== 429;
  }
}

export function isPaymentProviderRejection(error: unknown): error is PaymentProviderError {
  return error instanceof PaymentProviderError && error.rejected;
}

/** Short, admin-safe reason for a failed provider call (no stack, no secrets). */
export function describePaymentProviderFailure(error: unknown): string {
  if (error instanceof PaymentProviderError) {
    if (error.providerDescription) {
      return error.providerDescription.slice(0, 300);
    }
    return `${error.provider} returned HTTP ${error.httpStatus}`;
  }
  if (error instanceof AppError && error.statusCode === 503) {
    return 'Payment provider temporarily unavailable';
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'Payment provider did not respond in time';
  }
  return 'Payment provider request failed';
}
