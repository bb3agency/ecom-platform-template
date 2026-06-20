import { decryptOpsConfigValue } from '@common/security/ops-config-crypto';
import { isOpsConfigBootstrapKey, isOpsConfigKnownKey, isOpsConfigRuntimeOverlayKey } from './ops-config-contract';

type OpsConfigSecretRow = {
  secretKey: string;
  encryptedValue: string;
  isActive?: boolean;
};

export type OpsConfigRuntimePrismaLike = {
  opsConfigSecret: {
    findMany(args: { where: { isActive: true } }): Promise<OpsConfigSecretRow[]>;
  };
};

export type OpsConfigRuntimeOverlayReport = {
  appliedKeys: string[];
  skippedBootstrapKeys: string[];
  skippedUnknownKeys: string[];
  skippedInactiveKeys: string[];
  failedKeys: string[];
};

function isProductionLikeRuntime(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  return env !== 'development' && env !== 'test';
}

export async function applyOpsConfigRuntimeOverlay(
  prisma: OpsConfigRuntimePrismaLike
): Promise<OpsConfigRuntimeOverlayReport> {
  const report: OpsConfigRuntimeOverlayReport = {
    appliedKeys: [],
    skippedBootstrapKeys: [],
    skippedUnknownKeys: [],
    skippedInactiveKeys: [],
    failedKeys: []
  };

  const rows = await prisma.opsConfigSecret.findMany({ where: { isActive: true } });

  for (const row of rows) {
    const key = row.secretKey;
    if (row.isActive === false) {
      report.skippedInactiveKeys.push(key);
      continue;
    }
    if (isOpsConfigBootstrapKey(key)) {
      report.skippedBootstrapKeys.push(key);
      continue;
    }
    if (!isOpsConfigKnownKey(key) || !isOpsConfigRuntimeOverlayKey(key)) {
      report.skippedUnknownKeys.push(key);
      continue;
    }

    try {
      process.env[key] = decryptOpsConfigValue(row.encryptedValue);
      report.appliedKeys.push(key);
    } catch (error) {
      report.failedKeys.push(key);
      if (isProductionLikeRuntime()) {
        throw error;
      }
    }
  }

  return report;
}
