#!/usr/bin/env node
/**
 * Live notification diagnostic script.
 * Connects to the real DB and Redis to show exactly why emails are failing.
 *
 * Usage:
 *   cd /var/www/<client-id>/backend
 *   node scripts/diagnose-notifications.js
 */

const path = require('path');
const fs = require('fs');

// ─── load .env ──────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌  .env not found at', envPath);
  process.exit(1);
}
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
  if (key && !process.env[key]) process.env[key] = val;
}

const { PrismaClient } = require('@prisma/client');

const sep  = () => console.log('─'.repeat(64));
const ok   = (m) => console.log('  ✅', m);
const fail = (m) => console.log('  ❌', m);
const warn = (m) => console.log('  ⚠️ ', m);
const info = (m) => console.log('  ℹ️ ', m);

async function main() {
  console.log('\n' + '═'.repeat(64));
  console.log('  NOTIFICATION SYSTEM LIVE DIAGNOSTIC');
  console.log('═'.repeat(64) + '\n');

  // ── 1. env check ────────────────────────────────────────────────────────
  console.log('1. ENV VARIABLES');
  sep();
  const notifyEmail   = (process.env.NOTIFY_EMAIL_ENABLED ?? '').toLowerCase();
  const resendApiKey  = process.env.RESEND_API_KEY ?? '';
  const resendFrom    = process.env.RESEND_FROM ?? '';
  const databaseUrl   = process.env.DATABASE_URL ?? '';

  notifyEmail === 'true'
    ? ok(`NOTIFY_EMAIL_ENABLED = true`)
    : fail(`NOTIFY_EMAIL_ENABLED = "${notifyEmail}" (must be "true")`);

  resendApiKey
    ? ok(`RESEND_API_KEY is set (${resendApiKey.slice(0, 8)}…)`)
    : fail('RESEND_API_KEY is missing from .env');

  resendFrom
    ? ok(`RESEND_FROM = "${resendFrom}"`)
    : fail('RESEND_FROM is missing from .env');

  databaseUrl
    ? ok('DATABASE_URL is set')
    : fail('DATABASE_URL is missing — cannot query DB');

  if (!databaseUrl) process.exit(1);
  console.log();

  // ── 2. db connection ────────────────────────────────────────────────────
  console.log('2. DATABASE QUERIES');
  sep();
  const prisma = new PrismaClient({ errorFormat: 'pretty' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    ok('Connected to PostgreSQL');
  } catch (err) {
    fail(`Cannot connect to DB: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // ── 3. StoreSettings ────────────────────────────────────────────────────
  try {
    const s = await prisma.storeSettings.findFirst();
    if (!s) {
      warn('StoreSettings row not found — defaults apply (email enabled)');
    } else {
      console.log();
      console.log('  StoreSettings:');
      s.notifyEmailEnabled === true ? ok('notifyEmailEnabled = true') : fail(`notifyEmailEnabled = ${s.notifyEmailEnabled} (must be true)`);
      info(`storeName = "${s.storeName}"`);
    }
  } catch (err) {
    warn(`Could not query StoreSettings: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // ── 4. OpsConfigSecret ──────────────────────────────────────────────────
  console.log('3. OPS CONFIG SECRETS (DB-backed overlay)');
  sep();
  try {
    const rows = await prisma.opsConfigSecret.findMany({
      where: {
        secretKey: { in: ['RESEND_API_KEY', 'RESEND_FROM', 'NOTIFY_EMAIL_ENABLED'] }
      },
      orderBy: { secretKey: 'asc' }
    });
    const keys = new Set(rows.map(r => r.secretKey));
    const active = new Set(rows.filter(r => r.isActive).map(r => r.secretKey));

    ['RESEND_API_KEY', 'RESEND_FROM', 'NOTIFY_EMAIL_ENABLED'].forEach(k => {
      if (!keys.has(k)) {
        info(`${k} not in OpsConfigSecret — will use .env value`);
      } else if (!active.has(k)) {
        warn(`${k} in OpsConfigSecret but isActive=false — .env value used instead`);
      } else {
        ok(`${k} found in OpsConfigSecret (isActive=true, overrides .env)`);
      }
    });
  } catch (err) {
    warn(`Could not query OpsConfigSecret: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // ── 5. Recent NotificationLog ────────────────────────────────────────────
  console.log('4. RECENT NOTIFICATION LOG (last 10)');
  sep();
  try {
    const rows = await prisma.notificationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    if (!rows.length) {
      fail('NotificationLog is empty — notifications are NOT being enqueued at all');
      info('This means the outbox is not dispatching or the worker never ran');
    } else {
      for (const r of rows) {
        const ts = r.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });
        const line = `[${ts}] ${r.template} → ${r.recipient} | ${r.status}`;
        if (r.status === 'SENT') {
          ok(line);
        } else {
          fail(line);
          if (r.errorMessage) {
            console.log(`         └─ ${r.errorMessage}`);
          }
        }
      }
    }
  } catch (err) {
    warn(`Could not query NotificationLog: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // ── 6. OutboxMessage state ───────────────────────────────────────────────
  console.log('5. OUTBOX MESSAGE STATE');
  sep();
  try {
    const allMessages = await prisma.outboxMessage.findMany();
    const counts = {};
    for (const msg of allMessages) {
      counts[msg.status] = (counts[msg.status] || 0) + 1;
    }

    if (!Object.keys(counts).length) {
      warn('OutboxMessage table is empty');
    } else {
      for (const [status, cnt] of Object.entries(counts).sort()) {
        const c = Number(cnt);
        if (status === 'FAILED' && c > 0) {
          fail(`${status}: ${c} messages`);
        } else if (status === 'PENDING' && c > 5) {
          warn(`${status}: ${c} messages — backlog building up, check workers are running`);
        } else {
          ok(`${status}: ${c} messages`);
        }
      }
    }

    // Show last 5 FAILED outbox entries
    const failed = await prisma.outboxMessage.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    if (failed.length) {
      console.log('\n  Last FAILED outbox entries:');
      for (const r of failed) {
        const ts = r.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });
        fail(`[${ts}] ${r.queueName}:${r.jobName} (${r.attemptCount} attempts)`);
        if (r.lastError) console.log(`         └─ ${r.lastError}`);
      }
    }
  } catch (err) {
    warn(`Could not query OutboxMessage: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // ── 7. Pending outbox for notifications specifically ─────────────────────
  console.log('6. PENDING NOTIFICATION OUTBOX (stuck jobs)');
  sep();
  try {
    const rows = await prisma.outboxMessage.findMany({
      where: {
        queueName: 'notifications',
        status: 'PENDING'
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    if (!rows.length) {
      ok('No pending notification outbox messages');
    } else {
      warn(`${rows.length} notification(s) stuck as PENDING:`);
      for (const r of rows) {
        const ts = r.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });
        warn(`[${ts}] ${r.jobName} | attempts=${r.attemptCount} | jobId=${r.jobId ?? 'none'}`);
      }
      info('If workers are running, these should dispatch within 10s');
    }
  } catch (err) {
    warn(`Could not query pending outbox: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // ── 8. Resend API key live test ───────────────────────────────────────────
  if (resendApiKey) {
    console.log('7. RESEND API KEY LIVE TEST');
    sep();
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: resendFrom || 'onboarding@resend.dev',
          to: ['delivered@resend.dev'], // Resend's test address — always succeeds
          subject: 'Diagnostic test',
          html: '<p>Diagnostic test from <client-id> backend</p>'
        })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        ok(`Resend API is reachable and accepted the request (id: ${body.id ?? 'n/a'})`);
        if (resendFrom && !resendFrom.includes('@resend.dev')) {
          info('Note: test used delivered@resend.dev as recipient — real sends go to customer emails');
          info('Make sure your RESEND_FROM domain is verified in the Resend dashboard');
        }
      } else {
        fail(`Resend API returned ${res.status}: ${body.message ?? body.name ?? JSON.stringify(body)}`);
        if (res.status === 403) {
          fail('403 = API key is valid but you can only send to your own email (test mode key)');
          info('Use a production Resend API key (not re_test_*) to send to customer emails');
        } else if (res.status === 401) {
          fail('401 = API key is invalid or missing — update RESEND_API_KEY in .env');
        } else if (res.status === 422) {
          fail('422 = RESEND_FROM domain is not verified in Resend dashboard');
          info('Go to https://resend.com/domains → add & verify your domain');
        }
      }
    } catch (err) {
      fail(`Cannot reach Resend API: ${err.message}`);
    }
    console.log();
  }

  // ── summary ─────────────────────────────────────────────────────────────
  console.log('═'.repeat(64));
  console.log('  HOW TO READ THIS REPORT');
  console.log('═'.repeat(64));
  console.log('  • NotificationLog = FAILED  → check errorMessage above for exact Resend error');
  console.log('  • NotificationLog = empty   → outbox worker not running or not dispatching');
  console.log('  • OutboxMessage FAILED > 0  → check lastError; worker retried 5x and gave up');
  console.log('  • Resend 403               → using test API key; switch to production key');
  console.log('  • Resend 422               → from domain not verified; add domain in Resend');
  console.log('  • Everything ✅ but no email → check spam folder; verify recipient email is correct');
  console.log();

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\n❌ Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
