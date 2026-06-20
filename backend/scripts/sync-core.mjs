#!/usr/bin/env node
/**
 * sync-core.mjs — Apply a platform-core release tag to THIS client repo.
 *
 * Pulls ONLY core-owned files (per core-manifest.json) from the template's
 * release tag into the working tree, skips the design layer / client extension
 * folders / approved-divergence paths, also refreshes the matching CHANGELOG,
 * and bumps PLATFORM_VERSION for the synced layer.
 *
 * It does NOT commit — it leaves everything staged-ready so a workflow (or a
 * human) reviews the diff before committing + opening a PR.
 *
 * Usage:
 *   node backend/scripts/sync-core.mjs --tag backend-core-v0.1.2 [--remote template]
 *
 * Requires: a git remote (default `template`) pointing at the core template repo,
 * with the tag fetched/fetchable. See backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md §9.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // backend/scripts -> repo root

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
function gitQuiet(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const tag = arg('tag');
const remote = arg('remote', 'template');
if (!tag) fail('missing --tag (e.g. --tag backend-core-v0.1.2)');

const m = /^(backend|frontend)-core-v(\d+\.\d+\.\d+)$/.exec(tag);
if (!m) fail(`tag '${tag}' must look like backend-core-vX.Y.Z or frontend-core-vX.Y.Z`);
const layer = m[1]; // 'backend' | 'frontend'
const version = m[2];

// ---------- load manifest ----------
const manifestPath = join(ROOT, 'core-manifest.json');
if (!existsSync(manifestPath)) fail('core-manifest.json not found at repo root');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const layerKey = layer === 'backend' ? 'backendCore' : 'frontendCore';
const includes = manifest[layerKey]?.include ?? [];
const excludes = manifest[layerKey]?.exclude ?? [];
if (includes.length === 0) fail(`core-manifest.json has no ${layerKey}.include`);

// ---------- approved divergences (never overwritten) ----------
const pvPath = join(ROOT, 'PLATFORM_VERSION');
if (!existsSync(pvPath)) fail('PLATFORM_VERSION not found at repo root');
const pv = readFileSync(pvPath, 'utf8');
const approved = [];
{
  const lines = pv.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (/^approved-divergence:/.test(line)) {
      inBlock = !/\[\s*\]/.test(line); // `approved-divergence: []` => none
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break; // next top-level key ends the block
    const mm = /-\s*([^\s—-][^\s—]*)/.exec(line); // `  - path/to/file — justification — ...`
    if (mm) approved.push(mm[1].trim());
  }
}

// ---------- pathspec helpers ----------
function toPathspec(p, exclude = false) {
  if (p.endsWith('/**')) {
    const dir = p.slice(0, -3); // a dir matches recursively as a plain pathspec
    return exclude ? `:(exclude)${dir}` : dir;
  }
  if (p.includes('*')) {
    return exclude ? `:(exclude,glob)${p}` : `:(glob)${p}`;
  }
  return exclude ? `:(exclude)${p}` : p;
}
const negatives = [
  ...excludes.map((p) => toPathspec(p, true)),
  ...approved.map((p) => toPathspec(p, true))
];

// ---------- fetch + verify tag ----------
console.log(`Syncing ${layer}-core → ${version} from tag ${tag} (remote: ${remote})`);
try {
  gitQuiet(['fetch', remote, '--tags', '--quiet']);
} catch (e) {
  fail(`cannot fetch remote '${remote}': ${(e.stderr || e.message || '').trim()}`);
}
try {
  gitQuiet(['rev-parse', '--verify', `refs/tags/${tag}`]);
} catch {
  fail(`tag '${tag}' not found after fetch — is the template tagged AND pushed?`);
}
if (approved.length) {
  console.log(`  Preserving approved-divergence (not overwritten): ${approved.join(', ')}`);
}

// ---------- check out core files (tolerant of paths absent in the tag) ----------
const missing = [];
for (const inc of includes) {
  const spec = [tag, '--', toPathspec(inc, false), ...negatives];
  try {
    git(['checkout', ...spec]);
  } catch (e) {
    const msg = `${e.stderr || ''}${e.message || ''}`;
    if (/did not match/i.test(msg)) missing.push(inc);
    else fail(`git checkout failed for '${inc}': ${msg.trim()}`);
  }
}
// Also refresh the layer's CHANGELOG (the propagation record), if present in the tag.
const changelog = layer === 'backend' ? 'backend/CHANGELOG.md' : 'frontend/CHANGELOG.md';
try {
  git(['checkout', tag, '--', changelog]);
} catch {
  /* changelog optional */
}

// ---------- bump PLATFORM_VERSION ----------
// CRLF-safe: match the key + rest-of-line without consuming the newline.
const lineRe = new RegExp(`^(${layer}-core:)[^\\r\\n]*`, 'm');
if (lineRe.test(pv)) {
  writeFileSync(pvPath, pv.replace(lineRe, `$1 ${version}`));
} else {
  console.warn(`  WARN: no '${layer}-core:' line in PLATFORM_VERSION — not bumped.`);
}

// ---------- summary ----------
if (missing.length) {
  console.log(`  Note: ${missing.length} include path(s) absent in ${tag} (skipped): ${missing.join(', ')}`);
}
const changed = git(['status', '--porcelain']).trim();
console.log('\nFiles changed by sync:');
console.log(changed ? changed.split('\n').map((l) => '  ' + l).join('\n') : '  (none — already in sync)');
console.log(`\n✅ ${layer}-core synced to ${version}. Review, then commit + open PR.`);
console.log('   ⚠ Core file DELETIONS / renames are NOT auto-applied by a tag checkout — handle those by hand.');
