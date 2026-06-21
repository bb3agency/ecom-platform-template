#!/usr/bin/env node
/**
 * check-core-purity.mjs — Fail if any CORE file contains a client-specific
 * identifier (brand name, domain, slug). Core code must be client-agnostic so
 * the release-train can sync it to every client without overwriting their
 * identity. Client-specific values belong in the DESIGN LAYER
 * (frontend/lib/constants.ts -> APP_NAME / STORAGE_PREFIX, env, or Ops config),
 * or the file must be excluded from core in core-manifest.json.
 *
 * Scope  : core paths from core-manifest.json (include minus exclude).
 * Deny   : patterns from core-purity-denylist.txt (one JS-regex per line).
 * Usage  : node backend/scripts/check-core-purity.mjs   (npm run check:core-purity)
 *
 * This is the guard that prevents the "sync overwrote client X's brand/keys with
 * client Y's" class of bug. See backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md §7.1.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(ROOT, 'core-manifest.json');
const denyPath = join(ROOT, 'core-purity-denylist.txt');

if (!existsSync(manifestPath)) {
  console.error('ERROR: core-manifest.json not found');
  process.exit(2);
}
if (!existsSync(denyPath)) {
  console.log('ℹ️  core-purity-denylist.txt not found — skipping purity check.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const patterns = readFileSync(denyPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

if (patterns.length === 0) {
  console.log('✅ core-purity: denylist empty — nothing to check.');
  process.exit(0);
}

// Build a git pathspec for the CORE surface (includes, then exclude negatives).
function toPathspec(p, exclude = false) {
  if (p.endsWith('/**')) {
    const dir = p.slice(0, -3);
    return exclude ? `:(exclude)${dir}` : dir;
  }
  if (p.includes('*')) {
    return exclude ? `:(exclude,glob)${p}` : `:(glob)${p}`;
  }
  return exclude ? `:(exclude)${p}` : p;
}
const includes = [
  ...(manifest.backendCore?.include ?? []),
  ...(manifest.frontendCore?.include ?? [])
];
const excludes = [
  ...(manifest.backendCore?.exclude ?? []),
  ...(manifest.frontendCore?.exclude ?? [])
];
const pathspec = [
  ...includes.map((p) => toPathspec(p, false)),
  ...excludes.map((p) => toPathspec(p, true)),
  // Tests legitimately use sample brands/domains in fixtures/assertions — not shipped.
  ':(exclude,glob)**/*.test.*',
  ':(exclude,glob)**/*.spec.*',
  // The guard's own config files naturally contain the patterns — don't self-flag.
  ':(exclude)core-purity-denylist.txt',
  ':(exclude)core-purity-allow.txt'
];

// Per-client allow-list: THIS client's own identifiers (brand/domain/slug) are not a
// contamination risk — only ANOTHER client's identity leaking into core is. Optional,
// not synced. One regex per line; '#' comments.
const allowPath = join(ROOT, 'core-purity-allow.txt');
const allow = existsSync(allowPath)
  ? readFileSync(allowPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((p) => new RegExp(p, 'i'))
  : [];
const isAllowed = (line) => allow.some((re) => re.test(line));

// git grep each pattern across the core surface (case-insensitive, skip binary).
const violations = [];
for (const pat of patterns) {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-n', '-I', '-i', '--no-color', '-e', pat, '--', ...pathspec],
      { cwd: ROOT, encoding: 'utf8' }
    );
    if (out.trim()) {
      for (const line of out.trim().split('\n')) {
        if (!isAllowed(line)) violations.push(`[${pat}]  ${line}`);
      }
    }
  } catch (e) {
    if (e.status !== 1) {
      // status 1 = "no match" (fine). Anything else is a real error.
      console.error(`ERROR running git grep for '${pat}': ${(e.stderr || e.message || '').trim()}`);
      process.exit(2);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `❌ core-purity: ${violations.length} client identifier(s) found in CORE files.\n` +
      '   Move them to the design layer (lib/constants.ts -> APP_NAME / STORAGE_PREFIX, env,\n' +
      '   or Ops config), or exclude the file in core-manifest.json. Then re-run.\n'
  );
  for (const v of violations.slice(0, 80)) console.error('   ' + v);
  if (violations.length > 80) console.error(`   …and ${violations.length - 80} more.`);
  process.exit(1);
}

console.log('✅ core-purity: no client identifiers in core files.');
