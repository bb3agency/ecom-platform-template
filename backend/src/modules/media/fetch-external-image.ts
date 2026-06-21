import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { assertSafeExternalImageFetchUrl } from './assert-safe-external-image-url';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/** Fetches an external image with SSRF checks on every redirect hop. */
export async function fetchExternalImageResponse(sourceUrl: string): Promise<Response> {
  let currentUrl = sourceUrl.trim();
  assertSafeExternalImageFetchUrl(currentUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Storefront-MediaIngest/1.0' }
      });
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Failed to fetch external image URL', 400);
    }

    if (response.status >= 300 && response.status < 400) {
      const locationHeader = response.headers.get('location');
      if (!locationHeader) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'External image redirect missing location', 400);
      }
      currentUrl = new URL(locationHeader, currentUrl).toString();
      assertSafeExternalImageFetchUrl(currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `External image URL returned HTTP ${response.status}`,
        400
      );
    }

    return response;
  }

  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'External image URL redirected too many times', 400);
}
