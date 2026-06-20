import crypto from 'crypto';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

function resolveOpsEncryptionKeyRaw(): string {
  const key = process.env.OPS_DB_ENCRYPTION_KEY?.trim();

  if (!key) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'OPS_DB_ENCRYPTION_KEY is not configured', 500);
  }

  return key;
}

export function resolveOpsEncryptionKeyVersion(): number {
  const raw = Number(process.env.OPS_DB_ENCRYPTION_KEY_VERSION ?? 1);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
}

export function encryptOpsConfigValue(value: string): string {
  const key = crypto.createHash('sha256').update(resolveOpsEncryptionKeyRaw()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptOpsConfigValue(payload: string): string {
  const [ivRaw, tagRaw, dataRaw] = payload.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Stored ops config payload is malformed', 500);
  }
  const key = crypto.createHash('sha256').update(resolveOpsEncryptionKeyRaw()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskSecretValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}
