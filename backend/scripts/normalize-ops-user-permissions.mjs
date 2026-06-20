import 'dotenv/config';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import logger from './lib/logger.mjs';

const MANDATORY_OPS_PERMISSIONS = ['OPS_READ', 'OPS_WRITE'];

function normalizeHostShellDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.includes('host.docker.internal')) {
    return;
  }

  const runningInsideContainer = existsSync('/.dockerenv');
  if (runningInsideContainer) {
    return;
  }

  process.env.DATABASE_URL = databaseUrl.replace('host.docker.internal', '127.0.0.1');
  logger.info('DATABASE_URL host override applied for host-shell execution (host.docker.internal -> 127.0.0.1)');
}

function enforceMandatoryOpsPermissions(current) {
  const normalized = new Set((current ?? []).map((permission) => permission.trim().toUpperCase()));
  for (const required of MANDATORY_OPS_PERMISSIONS) {
    normalized.add(required);
  }
  return MANDATORY_OPS_PERMISSIONS.filter((permission) => normalized.has(permission));
}

function permissionsNeedUpgrade(current) {
  const enforced = enforceMandatoryOpsPermissions(current);
  const existing = current ?? [];
  return (
    enforced.length !== existing.length ||
    enforced.some((permission) => !existing.includes(permission))
  );
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eqIdx = token.indexOf('=');
    if (eqIdx !== -1) {
      args[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function printUsage() {
  process.stdout.write(`\nUsage:\n  node scripts/normalize-ops-user-permissions.mjs --yes\n\nEnsures every OpsUser and pending OpsUserInvite has OPS_READ + OPS_WRITE.\nRun once after deploying mandatory-permissions policy.\n\n`);
}

normalizeHostShellDatabaseUrl();

const prisma = new PrismaClient();
const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help || args.h) {
    printUsage();
    return;
  }
  if (args.yes !== 'true') {
    printUsage();
    throw new Error('Refusing to run without --yes');
  }

  const users = await prisma.opsUser.findMany({
    select: { id: true, email: true, permissions: true }
  });

  let updatedUsers = 0;
  for (const user of users) {
    const permissions = enforceMandatoryOpsPermissions(user.permissions);
    if (!permissionsNeedUpgrade(user.permissions)) {
      continue;
    }
    await prisma.opsUser.update({
      where: { id: user.id },
      data: { permissions }
    });
    updatedUsers += 1;
    logger.info(`Updated ops user permissions: ${user.email}`, { permissions });
  }

  const invites = await prisma.opsUserInvite.findMany({
    where: { status: { in: ['CREATED', 'EMAIL_SENT'] } },
    select: { id: true, inviteEmail: true, permissions: true }
  });

  let updatedInvites = 0;
  for (const invite of invites) {
    const permissions = enforceMandatoryOpsPermissions(invite.permissions);
    if (!permissionsNeedUpgrade(invite.permissions)) {
      continue;
    }
    await prisma.opsUserInvite.update({
      where: { id: invite.id },
      data: { permissions }
    });
    updatedInvites += 1;
    logger.info(`Updated pending ops invite permissions: ${invite.inviteEmail}`, { permissions });
  }

  logger.info('Ops permission normalization complete', {
    updatedUsers,
    updatedInvites,
    totalUsers: users.length
  });
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Ops permission normalization failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
