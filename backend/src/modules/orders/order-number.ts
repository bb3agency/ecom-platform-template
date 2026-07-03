import crypto from 'node:crypto';

/**
 * Customer-facing order number generation.
 *
 * SECURITY: order numbers used to be sequential (`ORD-2026-00039`), which leaked business
 * volume (competitors could infer sales rate from two orders) and made references enumerable.
 * Modern practice (Amazon's `114-3941689-…` reference groups, Stripe's random tokens) is an
 * UNGUESSABLE, human-readable reference:
 *  - random via `crypto.randomInt` (not Math.random);
 *  - unambiguous alphabet — no I/L/O/0/1, so support can read it over the phone;
 *  - grouped `ORD-XXXX-XXXX` for readability;
 *  - 8 chars over a 31-symbol alphabet ≈ 8.5e11 combinations — enumeration is infeasible and
 *    the birthday-collision odds are negligible even at millions of orders (the DB `@unique`
 *    constraint plus a pre-insert check is the final guard).
 *
 * NOTE: GST INVOICE numbers (`INV-YYYY-#####`) intentionally stay SEQUENTIAL — Indian GST
 * rules (CGST Rule 46(b)) require consecutive invoice serials. Only the order reference is random.
 */

/** Unambiguous alphabet: uppercase minus I/L/O, digits minus 0/1. */
const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ORDER_NUMBER_RANDOM_LENGTH = 8;

export const ORDER_NUMBER_PATTERN = /^ORD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function generateOrderNumber(): string {
  let raw = '';
  for (let i = 0; i < ORDER_NUMBER_RANDOM_LENGTH; i += 1) {
    raw += ORDER_NUMBER_ALPHABET[crypto.randomInt(ORDER_NUMBER_ALPHABET.length)];
  }
  return `ORD-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

type OrderNumberLookup = {
  order: {
    findUnique: (args: {
      where: { orderNumber: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

const MAX_GENERATION_ATTEMPTS = 5;

/**
 * Generates an order number that is verified unused (belt) before the insert relies on the
 * DB unique constraint (suspenders). Works with either the root Prisma client or a
 * transaction client.
 */
export async function generateUniqueOrderNumber(client: OrderNumberLookup): Promise<string> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateOrderNumber();
    const existing = await client.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true }
    });
    if (!existing) {
      return candidate;
    }
  }
  // Statistically unreachable (5 consecutive collisions at ~1e-6 fill each) — fail loudly
  // rather than looping forever inside a checkout transaction.
  throw new Error('Unable to generate a unique order number after multiple attempts');
}
