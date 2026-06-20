import { describe, expect, it } from 'vitest';

import { AppError } from './app-error';
import { ERROR_CODES } from './error-codes';

describe('AppError', () => {
  it('preserves code, status, message, and details', () => {
    const error = new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid input', 400, {
      kind: 'validation',
      hintKey: 'bad_field'
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid input');
    expect(error.details).toEqual({ kind: 'validation', hintKey: 'bad_field' });
  });

  it('supports undefined details', () => {
    const error = new AppError(ERROR_CODES.INTERNAL_ERROR, 'Unexpected failure', 500);

    expect(error.details).toBeUndefined();
  });
});
