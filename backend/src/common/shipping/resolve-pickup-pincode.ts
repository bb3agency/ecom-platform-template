import { decryptOpsConfigValue } from '@common/security/ops-config-crypto';

export const PICKUP_PINCODE_ENV_KEYS = ['SHIPROCKET_PICKUP_PINCODE', 'DELHIVERY_PICKUP_PINCODE'] as const;

export type ResolvePickupPincodePrisma = {
  storeSettings: {
    findUnique(args: {
      where: { singletonKey: string };
      select: { pickupPincode: true };
    }): Promise<{ pickupPincode: string | null } | null>;
  };
  opsConfigSecret?: {
    findMany(args: {
      where: { isActive: true; secretKey: { in: string[] } };
      select: { secretKey: true; encryptedValue: true };
    }): Promise<Array<{ secretKey: string; encryptedValue: string }>>;
  };
};

export type ResolvePickupPincodeOptions = {
  /** Used when shipping runs in noop/dev simulation mode. */
  noopFallback?: string | null;
};

async function resolvePickupPincodeEnvOverlay(
  prisma: ResolvePickupPincodePrisma
): Promise<Record<(typeof PICKUP_PINCODE_ENV_KEYS)[number], string | undefined>> {
  const runtime: Record<string, string | undefined> = {};
  for (const key of PICKUP_PINCODE_ENV_KEYS) {
    const envValue = process.env[key];
    if (envValue) {
      runtime[key] = envValue;
    }
  }

  if (!prisma.opsConfigSecret?.findMany) {
    return runtime as Record<(typeof PICKUP_PINCODE_ENV_KEYS)[number], string | undefined>;
  }

  const rows = await prisma.opsConfigSecret.findMany({
    where: {
      isActive: true,
      secretKey: { in: [...PICKUP_PINCODE_ENV_KEYS] }
    },
    select: {
      secretKey: true,
      encryptedValue: true
    }
  });

  for (const row of rows) {
    runtime[row.secretKey] = decryptOpsConfigValue(row.encryptedValue);
  }

  return runtime as Record<(typeof PICKUP_PINCODE_ENV_KEYS)[number], string | undefined>;
}

/**
 * Resolves merchant pickup pincode: StoreSettings DB → Ops overlay / env
 * (SHIPROCKET_PICKUP_PINCODE, then DELHIVERY_PICKUP_PINCODE).
 */
export async function resolvePickupPincode(
  prisma: ResolvePickupPincodePrisma,
  options: ResolvePickupPincodeOptions = {}
): Promise<string | null> {
  const settings = await prisma.storeSettings.findUnique({
    where: { singletonKey: 'default' },
    select: { pickupPincode: true }
  });
  const fromSettings = settings?.pickupPincode?.trim();
  if (fromSettings) {
    return fromSettings;
  }

  const runtime = await resolvePickupPincodeEnvOverlay(prisma);
  const fromEnv = runtime.SHIPROCKET_PICKUP_PINCODE ?? runtime.DELHIVERY_PICKUP_PINCODE;
  if (fromEnv?.trim()) {
    return fromEnv.trim();
  }

  return options.noopFallback ?? null;
}
