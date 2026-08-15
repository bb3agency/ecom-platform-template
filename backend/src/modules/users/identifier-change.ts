import crypto from 'crypto';

/**
 * Verified change of an account's login identifiers (email / phone).
 *
 * Pentest F-1 (2026-08-15, High): `PATCH /users/me` accepted `email` and `phone`
 * as ordinary profile fields. Anyone holding a victim's access token could rebind
 * the account to attacker-controlled identifiers — uniqueness checks only prove
 * the value is unused, never that the requester owns it — after which password
 * reset and phone-OTP recovery both pointed at the attacker: full takeover.
 *
 * Those fields are gone from the profile schema. A change now requires TWO codes:
 *
 *  1. **Current-identifier OTP** — sent to the address/number already on the
 *     account. This is the security boundary: an attacker with a stolen access
 *     token cannot read the victim's inbox or SMS. Verifying only the NEW value
 *     would be useless here, because the attacker owns the new value.
 *  2. **New-identifier OTP** — sent to the value being set. Proves it is real and
 *     reachable, so a typo cannot silently hand account recovery to a stranger's
 *     mailbox (or lock the owner out of their own recovery path).
 *
 * On success the caller commits the change, revokes every session, and notifies
 * the OLD identifier so a surprised owner can react.
 */

/** Challenge lifetime — longer than a login OTP because two codes must arrive. */
export const IDENTIFIER_CHANGE_TTL_SECONDS = 10 * 60;
/** Wrong-code budget per challenge before it is destroyed. */
export const IDENTIFIER_CHANGE_MAX_ATTEMPTS = 5;
/** Minimum gap between change requests for one user+type (anti-spam/anti-bombing). */
export const IDENTIFIER_CHANGE_RESEND_SECONDS = 60;

export type IdentifierType = 'email' | 'phone';

/** Where a challenge's codes were delivered, for the response and the audit note. */
export type IdentifierChangeChallenge = {
  type: IdentifierType;
  /** Normalised value being set, or null when removing a phone. */
  newValue: string | null;
  currentOtpHash: string;
  /** Absent when removing an identifier — there is no new value to verify. */
  newOtpHash?: string;
  /** Masked, for UI copy only ("we sent a code to j••@example.com"). */
  currentTargetMasked: string;
  newTargetMasked: string | null;
  createdAtIso: string;
};

export function identifierChangeKey(userId: string, type: IdentifierType): string {
  return `identifier-change:${userId}:${type}`;
}

export function identifierChangeAttemptsKey(userId: string, type: IdentifierType): string {
  return `identifier-change:attempts:${userId}:${type}`;
}

export function identifierChangeCooldownKey(userId: string, type: IdentifierType): string {
  return `identifier-change:cooldown:${userId}:${type}`;
}

/** Same construction as the login OTP: 6 digits from a CSPRNG. */
export function generateIdentifierOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function hashIdentifierOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Constant-time comparison of the stored hash against a supplied code, so a
 * remote attacker cannot narrow the code down by measuring response times.
 * Returns false (never throws) on any malformed input.
 */
export function matchesIdentifierOtp(storedHash: string, suppliedOtp: string): boolean {
  const suppliedHash = hashIdentifierOtp(String(suppliedOtp ?? '').trim());
  const a = Buffer.from(storedHash, 'utf8');
  const b = Buffer.from(suppliedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.trim();
}

/** `jonathan@example.com` → `jo••••••@example.com`; never reveals the full value. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** `9876543210` → `••••••3210`. */
export function maskPhoneNumber(phone: string): string {
  if (phone.length <= 4) return '•'.repeat(phone.length);
  return `${'•'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export function maskIdentifier(type: IdentifierType, value: string): string {
  return type === 'email' ? maskEmail(value) : maskPhoneNumber(value);
}

export type AccountIdentifiers = {
  email: string | null;
  phone: string | null;
};

export type TrustedIdentifier = {
  channel: IdentifierType;
  value: string;
};

/**
 * The identifier the confirmation code is sent to: the one being replaced when
 * the account has it, otherwise the account's other contact (adding an email to
 * a phone-only account is confirmed by SMS, and vice-versa). Null when the
 * account has neither — impossible for a real user, but callers must handle it
 * rather than silently skipping the check.
 */
export function resolveTrustedIdentifier(
  account: AccountIdentifiers,
  type: IdentifierType
): TrustedIdentifier | null {
  const sameChannel = type === 'email' ? account.email : account.phone;
  if (sameChannel && sameChannel.trim().length > 0) {
    return { channel: type, value: sameChannel.trim() };
  }
  const otherChannel = type === 'email' ? account.phone : account.email;
  if (otherChannel && otherChannel.trim().length > 0) {
    return { channel: type === 'email' ? 'phone' : 'email', value: otherChannel.trim() };
  }
  return null;
}
