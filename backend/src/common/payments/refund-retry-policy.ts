/**
 * Refund retry policy + the history-note vocabulary the refunds worker writes.
 *
 * Why a slow schedule: the commonest refund failure is the provider refusing
 * because the merchant's balance is too low (captured money has already been
 * settled to the bank). Retrying in seconds cannot fix that; new captured
 * payments (or the owner adding funds) can, which takes hours. So after the
 * fast BullMQ attempts we keep retrying on this schedule for ~3 days, then
 * stop and leave the refund visible as owed for the admin to retry by hand.
 */
export const REFUND_AUTO_RETRY_DELAYS_MS: readonly number[] = [
  15 * 60_000, // 15 min
  60 * 60_000, // 1 h
  3 * 60 * 60_000, // 3 h
  ...Array.from({ length: 11 }, () => 6 * 60 * 60_000) // then every 6 h
];

export const REFUND_AUTO_RETRY_WINDOW_LABEL = '3 days';

/** Prefixes of OrderStatusHistory notes written for refund events (never status changes). */
export const REFUND_NOTE = {
  sent: 'Refund sent to provider',
  failedRetrying: 'Refund failed',
  stillOwed: 'Refund still owed',
  failedAtProvider: 'Refund failed at provider'
} as const;

export function nextRefundRetryDelayMs(round: number): number | null {
  return round >= 0 && round < REFUND_AUTO_RETRY_DELAYS_MS.length ? REFUND_AUTO_RETRY_DELAYS_MS[round]! : null;
}

/**
 * Refund notes that describe the MERCHANT's side (provider errors, balance
 * problems, retries) — never shown to the customer. The customer sees the
 * cancellation, and later the refund once the provider confirms it.
 */
export function isMerchantOnlyRefundNote(note: string | null): boolean {
  if (!note) return false;
  return (
    note.startsWith(REFUND_NOTE.failedRetrying) ||
    note.startsWith(REFUND_NOTE.stillOwed) ||
    note.startsWith(REFUND_NOTE.failedAtProvider) ||
    note.startsWith('Refund retry requested') ||
    // Legacy: written once per attempt, before the provider answered.
    note.startsWith('Refund initiated')
  );
}
