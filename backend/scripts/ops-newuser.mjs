import 'dotenv/config';
import crypto from 'crypto';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import logger from './lib/logger.mjs';

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

normalizeHostShellDatabaseUrl();

const prisma = new PrismaClient();
const OPS_PERMISSIONS = new Set(['OPS_READ', 'OPS_WRITE']);
const INVITE_TTL_MS = 10 * 60 * 1000;

function printUsage() {
  process.stdout.write(`\nUsage:\n  node scripts/ops-newuser.mjs --email=<email> --name="Ops User" --setup-base-url="https://client.com" [--permissions=OPS_READ,OPS_WRITE] [--created-by-email=ops@example.com] --yes\n\n`);
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

function requireValue(value, field) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required argument: --${field}`);
  }
}

function normalizePermissions(raw) {
  const input = String(raw || 'OPS_READ,OPS_WRITE')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(input)];
  for (const permission of unique) {
    if (!OPS_PERMISSIONS.has(permission)) {
      throw new Error(`Invalid ops permission: ${permission}`);
    }
  }
  return unique;
}

function hashOpaqueToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sendInviteEmail({ to, name, setupUrl, expiresAt }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error(
      'RESEND_API_KEY and RESEND_FROM must be set in .env before running ops-newuser (Phase 1 bootstrap).\n' +
      'See docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md — Step 1.'
    );
  }

  const html = `<h2>Ops account setup</h2><p>Hello ${name},</p><p>Open this setup link to activate your ops account:</p><p><a href="${setupUrl}">${setupUrl}</a></p><p>This link expires at ${expiresAt}.</p>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Ops setup invite',
      html
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend request failed: ${response.status} ${text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true' || args.h === 'true') {
    printUsage();
    return;
  }

  requireValue(args.email, 'email');
  requireValue(args.name, 'name');
  requireValue(args['setup-base-url'], 'setup-base-url');
  if (String(args.yes).toLowerCase() !== 'true') {
    throw new Error('Refusing to run without explicit --yes');
  }

  const inviteEmail = String(args.email).trim().toLowerCase();
  const inviteName = String(args.name).trim();
  const permissions = normalizePermissions(args.permissions);
  const setupBaseUrl = String(args['setup-base-url']).trim().replace(/\/$/, '');

  if (!inviteEmail.includes('@')) {
    throw new Error('Invalid email format');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const inviteTokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  let createdByOpsUserId = null;
  if (args['created-by-email']) {
    const creatorEmail = String(args['created-by-email']).trim().toLowerCase();
    const creator = await prisma.opsUser.findUnique({ where: { email: creatorEmail } });
    if (!creator) {
      throw new Error(`No OpsUser found for --created-by-email=${creatorEmail}`);
    }
    createdByOpsUserId = creator.id;
  }

  const invite = await prisma.opsUserInvite.create({
    data: {
      inviteEmail,
      inviteName,
      inviteTokenHash,
      setupBaseUrl,
      status: 'CREATED',
      permissions,
      expiresAt,
      ...(createdByOpsUserId ? { createdByOpsUserId } : {})
    }
  });

  const setupUrl = `${setupBaseUrl}/ops/setup?token=${encodeURIComponent(token)}`;

  await sendInviteEmail({
    to: inviteEmail,
    name: inviteName,
    setupUrl,
    expiresAt: expiresAt.toISOString()
  });

  await prisma.opsUserInvite.update({
    where: { id: invite.id },
    data: { status: 'EMAIL_SENT' }
  });

  logger.success('Ops invite created and email sent');
  logger.info(`INVITE_ID=${invite.id}`);
  logger.info(`INVITE_EMAIL=${inviteEmail}`);
  logger.info(`INVITE_EXPIRES_AT=${expiresAt.toISOString()}`);
  logger.info(`SETUP_URL=${setupUrl}`);
}

main()
  .catch((error) => {
    logger.error(`ops-newuser failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
