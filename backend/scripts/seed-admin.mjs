// Creates the default admin user for local dev / E2E testing
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import logger from './lib/logger.mjs';

// Load .env
const envPath = resolve(process.cwd(), '.env');
const lines = readFileSync(envPath, 'utf8').split('\n');
for (const line of lines) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  const val = t.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const prisma = new PrismaClient();

const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
const forceReset =
  process.argv.includes('--reset') ||
  (process.env.SEED_ADMIN_RESET ?? '').trim().toLowerCase() === 'true';

const allPermissions = [
  'products:read','products:write','categories:read','categories:write',
  'inventory:read','inventory:write','coupons:read','coupons:write',
  'settings:read','settings:write','reviews:read','reviews:moderate',
  'dashboard:read','analytics:read','orders:read','orders:write',
  'orders:export','orders:refund','orders:notify','analytics:export',
  'analytics:replay','users:read','users:write','shipments:read',
  'payments:read','ops:read','ops:write'
];

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  if (existing && !forceReset) {
    logger.info(`Admin already exists: ${EMAIL} (use --reset to recreate password + permissions)`);
    return;
  }

  if (existing && forceReset) {
    await prisma.adminPermissionGrant.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
    logger.info(`Removed existing admin: ${EMAIL}`);
  }

  const hash = await bcrypt.hash(PASSWORD, 12);
  const admin = await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: hash,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      isVerified: true,
      isBanned: false,
    }
  });

  await prisma.adminPermissionGrant.createMany({
    data: allPermissions.map(p => ({ userId: admin.id, permission: p }))
  });

  logger.success(`Admin created: ${admin.email} / ${PASSWORD} (${allPermissions.length} permissions granted)`);
}

main().catch(e => { logger.fatal(e.message || String(e)); }).finally(() => prisma.$disconnect());
