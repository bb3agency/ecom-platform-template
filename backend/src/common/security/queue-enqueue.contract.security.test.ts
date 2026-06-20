import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Inventory: all paths that call `queue.add` or persist outbox rows for async work.
 * Update this list when adding new enqueue sites.
 */
const ROOT = join(__dirname, '..', '..', '..');
const ENQUEUE_SOURCE_FILES = [
  'src/modules/orders/orders.service.ts',
  'src/modules/cart/cart.service.ts',
  'src/modules/auth/auth.service.ts',
  'src/modules/products/products.service.ts',
  'src/modules/analytics/analytics.service.ts',
  'queues/workers/order-processing.worker.ts',
  'queues/workers/shipping.worker.ts',
  'queues/workers/outbox-dispatch.worker.ts',
  'queues/workers/inventory-alerts.worker.ts'
];

const BUFFER_AS_JOB_DATA = /\.add\(\s*['"][^'"]+['"]\s*,\s*Buffer\b/;
const FORBIDDEN_TOKEN = /\brawBody\b/;

describe('Queue enqueue contract (security regression)', () => {
  for (const rel of ENQUEUE_SOURCE_FILES) {
    it(`${rel} does not pass Buffer / raw body blobs as Bull job data`, () => {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      expect(text, 'queue.add must not take Buffer as job payload').not.toMatch(BUFFER_AS_JOB_DATA);
      expect(text, 'enqueue paths must not name raw ingress blobs rawBody').not.toMatch(FORBIDDEN_TOKEN);
    });
  }
});
