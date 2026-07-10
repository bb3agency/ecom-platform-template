import { afterEach, describe, expect, it } from 'vitest';
import { featureFlags } from '@config/feature-flags';
import { resolveGstInvoicingEnabled } from './gst-invoicing-flag';

function prismaWith(gstInvoicingEnabled: boolean | null | undefined | 'throw') {
  return {
    storeSettings: {
      findUnique: async () => {
        if (gstInvoicingEnabled === 'throw') throw new Error('db down');
        return { gstInvoicingEnabled };
      }
    }
  } as never;
}

describe('resolveGstInvoicingEnabled', () => {
  const original = featureFlags.gstInvoicing;
  afterEach(() => {
    featureFlags.gstInvoicing = original;
  });

  it('uses the stored merchant toggle when set — true overrides env=false', async () => {
    featureFlags.gstInvoicing = false;
    await expect(resolveGstInvoicingEnabled(prismaWith(true))).resolves.toBe(true);
  });

  it('uses the stored merchant toggle when set — false overrides env=true', async () => {
    featureFlags.gstInvoicing = true;
    await expect(resolveGstInvoicingEnabled(prismaWith(false))).resolves.toBe(false);
  });

  it('inherits the env default when the toggle is unset (null)', async () => {
    featureFlags.gstInvoicing = true;
    await expect(resolveGstInvoicingEnabled(prismaWith(null))).resolves.toBe(true);
    featureFlags.gstInvoicing = false;
    await expect(resolveGstInvoicingEnabled(prismaWith(null))).resolves.toBe(false);
  });

  it('fails safe to the env default on read error', async () => {
    featureFlags.gstInvoicing = true;
    await expect(resolveGstInvoicingEnabled(prismaWith('throw'))).resolves.toBe(true);
  });
});
