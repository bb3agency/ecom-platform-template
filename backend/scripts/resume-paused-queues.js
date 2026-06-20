#!/usr/bin/env node
/* eslint-disable */
/**
 * resume-paused-queues.js
 *
 * Recovery script: detects any BullMQ queue that is currently paused in Redis
 * and resumes it via Queue.resume() (which atomically clears bull:<q>:meta.paused
 * AND moves jobs from the paused list back to wait).
 *
 * Use this when:
 *   - A scheduled-process-restart or maintenance-activation drain protocol
 *     paused queues but the resume step did not complete (e.g. resume raced
 *     with process.exit, Redis write was lost, or resume threw and was logged
 *     but not alerted because the alert itself enqueues to the now-paused
 *     notifications queue).
 *
 *   - Symptom: jobs sit in `bull:<queue>:paused` list forever, workers are up
 *     but idle, and HGET bull:<queue>:meta paused returns "1".
 *
 * Usage on the VPS (run inside the workers container so REDIS_URL is available):
 *
 *   docker exec raghava-organics-workers node scripts/resume-paused-queues.js
 *
 * Optional flags:
 *   --dry-run     Only report paused queues, do not resume.
 *   --queues=a,b  Restrict to specific queue names (default: all known queues).
 *
 * Exit codes:
 *   0  success (zero or more queues resumed)
 *   1  could not connect to Redis or resume failed on at least one queue
 */

const path = require('path');
const fs = require('fs');

// Load .env from the script's parent directory if REDIS_URL is not already in env.
// This lets the script work both inside the workers container (env is already set)
// and from a bare `node` shell on the VPS host (read .env from backend/).
(function loadDotEnvIfNeeded() {
  if (process.env.REDIS_URL) return;
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const ALL_QUEUE_NAMES = [
  'order-processing',
  'notifications',
  'shipping',
  'inventory-alerts',
  'refunds',
  'analytics',
  'cart-cleanup',
  'outbox-dispatch',
  'reconciliation',
  'dead-letter'
];

function parseArgs(argv) {
  const flags = { dryRun: false, queues: ALL_QUEUE_NAMES.slice() };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--queues=')) {
      const list = arg.slice('--queues='.length).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length > 0) flags.queues = list;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: node scripts/resume-paused-queues.js [--dry-run] [--queues=a,b]\n'
      );
      process.exit(0);
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv);
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    process.stderr.write('FATAL: REDIS_URL not set. Run from inside the workers container or backend/ directory.\n');
    process.exit(1);
  }

  let Queue, IORedis;
  try {
    ({ Queue } = require('bullmq'));
    IORedis = require('ioredis');
  } catch (err) {
    process.stderr.write(
      `FATAL: could not require bullmq/ioredis. Are you inside the workers container? (${err && err.message ? err.message : err})\n`
    );
    process.exit(1);
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    family: 4,
    keepAlive: 5_000,
    connectTimeout: 15_000,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 300, 3_000),
    reconnectOnError: () => true
  });
  connection.on('error', (err) => {
    process.stderr.write(`Redis error: ${err && err.message ? err.message : err}\n`);
  });

  const summary = { resumed: [], alreadyResumed: [], failed: [], skipped: [] };

  for (const name of flags.queues) {
    const q = new Queue(name, { connection });
    try {
      const isPaused = await q.isPaused();
      if (!isPaused) {
        process.stdout.write(`  ${name}: ok (not paused)\n`);
        summary.alreadyResumed.push(name);
        await q.close();
        continue;
      }

      const counts = await q.getJobCounts('wait', 'active', 'paused', 'delayed', 'completed', 'failed').catch(() => ({}));
      process.stdout.write(
        `  ${name}: PAUSED (paused=${counts.paused ?? '?'} wait=${counts.wait ?? '?'} active=${counts.active ?? '?'} failed=${counts.failed ?? '?'})\n`
      );

      if (flags.dryRun) {
        process.stdout.write(`     -> dry-run, not resuming\n`);
        summary.skipped.push(name);
      } else {
        await q.resume();
        const stillPaused = await q.isPaused();
        if (stillPaused) {
          process.stdout.write(`     -> resume() returned but queue is STILL paused; investigate manually\n`);
          summary.failed.push(name);
        } else {
          process.stdout.write(`     -> resumed\n`);
          summary.resumed.push(name);
        }
      }
    } catch (err) {
      process.stderr.write(
        `  ${name}: ERROR ${err && err.message ? err.message : String(err)}\n`
      );
      summary.failed.push(name);
    } finally {
      await q.close().catch(() => undefined);
    }
  }

  await connection.quit().catch(() => undefined);

  process.stdout.write('\nSummary:\n');
  process.stdout.write(`  resumed:         ${summary.resumed.join(', ') || '(none)'}\n`);
  process.stdout.write(`  already running: ${summary.alreadyResumed.join(', ') || '(none)'}\n`);
  process.stdout.write(`  skipped:         ${summary.skipped.join(', ') || '(none)'}\n`);
  process.stdout.write(`  failed:          ${summary.failed.join(', ') || '(none)'}\n`);

  process.exit(summary.failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
