#!/usr/bin/env node
/**
 * sync-core.mjs — Apply a platform-core release tag to THIS client repo using a
 * cruft/copier-style THREE-WAY MERGE (not a wholesale overwrite).
 *
 * Instead of replacing core files with the tag's content (which silently
 * discards any client-side change and can regress markers), this computes the
 * DELTA between the client's currently-pinned core tag (old) and the requested
 * tag (new), then applies that delta on top of the client's current tree with
 * `git apply --3way`. Result:
 *   • client-local edits to UNRELATED lines survive,
 *   • only genuine overlaps produce conflict markers (which fail CI → resolved in the PR),
 *   • file deletions AND renames between versions ARE applied (the old engine could not),
 *   • the design layer / client extensions / approved-divergence paths are never touched,
 *   • PLATFORM_VERSION only ever ADVANCES (downgrade guard).
 *
 * It does NOT commit — it leaves the working tree ready for a workflow (or a
 * human) to review the diff, then commit + open a PR.
 *
 * Usage:
 *   node backend/scripts/sync-core.mjs --tag backend-core-v0.1.5 [--remote template]
 *
 * Requires: a git remote (default `template`) pointing at the core template repo,
 * with the tag fetched/fetchable. See backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md §9.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // backend/scripts -> repo root

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
}
function gitQuiet(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function tagExists(t) {
  try {
    gitQuiet(['rev-parse', '--verify', `refs/tags/${t}`]);
    return true;
  } catch {
    return false;
  }
}
function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}
/** Returns >0 if a>b, <0 if a<b, 0 if equal. Plain semver (X.Y.Z). */
function semverCmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const tag = arg('tag');
const remote = arg('remote', 'template');
if (!tag) fail('missing --tag (e.g. --tag backend-core-v0.1.5)');

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

// ---------- read PLATFORM_VERSION: current pinned version + approved divergences ----------
const pvPath = join(ROOT, 'PLATFORM_VERSION');
if (!existsSync(pvPath)) fail('PLATFORM_VERSION not found at repo root');
const pv = readFileSync(pvPath, 'utf8');

const curMatch = new RegExp(`^${layer}-core:\\s*([0-9]+\\.[0-9]+\\.[0-9]+)`, 'm').exec(pv);
const currentVersion = curMatch ? curMatch[1] : null;

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

// ---------- downgrade guard ----------
if (currentVersion && semverCmp(version, currentVersion) <= 0) {
  console.log(
    `ℹ️  ${layer}-core is already at ${currentVersion} (>= requested ${version}). ` +
      `Nothing to do — sync never downgrades a marker.`
  );
  process.exit(0);
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
const includeSpecs = includes.map((p) => toPathspec(p, false));
const negatives = [
  ...excludes.map((p) => toPathspec(p, true)),
  ...approved.map((p) => toPathspec(p, true))
];

// ---------- fetch + verify tags ----------
console.log(
  `Syncing ${layer}-core: ${currentVersion ?? '(unknown)'} → ${version}  (tag ${tag}, remote: ${remote})`
);
try {
  gitQuiet(['fetch', remote, '--tags', '--quiet']);
} catch (e) {
  fail(`cannot fetch remote '${remote}': ${(e.stderr || e.message || '').trim()}`);
}
if (!tagExists(tag)) {
  fail(`tag '${tag}' not found after fetch — is the template tagged AND pushed?`);
}
if (approved.length) {
  console.log(`  Preserving approved-divergence (not overwritten): ${approved.join(', ')}`);
}

const oldTag = currentVersion ? `${layer}-core-v${currentVersion}` : null;
const changelog = layer === 'backend' ? 'backend/CHANGELOG.md' : 'frontend/CHANGELOG.md';
const conflicts = [];

/** Apply `git diff oldTag..newTag -- <spec>` onto the working tree via 3-way. */
function applyDelta(pathspecs, label) {
  const patch = git(['diff', '--binary', oldTag, tag, '--', ...pathspecs, ...negatives]);
  if (!patch.trim()) {
    return false; // no change between versions for these paths
  }
  try {
    // --3way: fall back to a true 3-way merge (leaving conflict markers) where
    // context doesn't apply cleanly, instead of rejecting the whole patch.
    git(['apply', '--3way', '--whitespace=nowarn'], { input: patch });
  } catch (e) {
    // --3way exits non-zero when it produced conflict markers; that is expected
    // and recoverable (CI will go red on the markers). A hard failure (base blob
    // missing, malformed patch) also lands here — surface it but keep going so the
    // operator sees the full picture.
    const msg = `${e.stderr || ''}${e.stdout || ''}${e.message || ''}`;
    const conflicted = msg.match(/with conflicts|U\s+\S+|needs merge/i);
    if (!conflicted) {
      console.warn(`  ⚠ ${label}: git apply reported: ${msg.trim().split('\n').slice(0, 3).join(' | ')}`);
    }
  }
  return true;
}

if (oldTag && tagExists(oldTag)) {
  // ----- normal path: apply ONLY the delta between versions (3-way) -----
  console.log(`  Applying delta ${oldTag} → ${tag} (3-way merge; client edits preserved)`);
  applyDelta(includeSpecs, 'core');
  // CHANGELOG is append-only, core-OWNED documentation. Clients routinely diverge
  // from it (they don't carry every template entry), so a 3-way delta reliably
  // CONFLICTS and leaves an unmerged index entry that breaks the downstream
  // `git checkout -B`/commit in core-sync.yml. Take the tag's version wholesale —
  // clients are not meant to edit the core changelog, so there's nothing to merge.
  try {
    git(['checkout', tag, '--', changelog]);
  } catch {
    /* changelog optional / absent in tag — ignore */
  }

  // Detect conflict markers left by --3way in any touched file.
  const touched = [...new Set(git(['diff', '--name-only']).trim().split('\n').filter(Boolean))];
  for (const f of touched) {
    try {
      const content = readFileSync(join(ROOT, f), 'utf8');
      if (/^<{7}|^={7}$|^>{7}/m.test(content)) conflicts.push(f);
    } catch {
      /* deleted/binary — skip */
    }
  }
} else {
  // ----- bootstrap path: no known baseline tag → wholesale checkout (old behavior) -----
  console.log(
    `  No baseline tag ${oldTag ?? '(none)'} available — first-time sync: checking out core files wholesale from ${tag}.`
  );
  const missing = [];
  for (const inc of includes) {
    try {
      git(['checkout', tag, '--', toPathspec(inc, false), ...negatives]);
    } catch (e) {
      const msg = `${e.stderr || ''}${e.message || ''}`;
      if (/did not match/i.test(msg)) missing.push(inc);
      else fail(`git checkout failed for '${inc}': ${msg.trim()}`);
    }
  }
  try {
    git(['checkout', tag, '--', changelog]);
  } catch {
    /* changelog optional */
  }
  if (missing.length) {
    console.log(`  Note: ${missing.length} include path(s) absent in ${tag} (skipped): ${missing.join(', ')}`);
  }
}

// ---------- bump PLATFORM_VERSION (advance only — guarded above) ----------
const lineRe = new RegExp(`^(${layer}-core:)[^\\r\\n]*`, 'm');
if (lineRe.test(pv)) {
  writeFileSync(pvPath, pv.replace(lineRe, `$1 ${version}`));
} else {
  console.warn(`  WARN: no '${layer}-core:' line in PLATFORM_VERSION — not bumped.`);
}

// ---------- summary ----------
const changed = git(['status', '--porcelain']).trim();
console.log('\nFiles changed by sync:');
console.log(changed ? changed.split('\n').map((l) => '  ' + l).join('\n') : '  (none — already in sync)');

if (conflicts.length) {
  console.log(`\n⚠ ${conflicts.length} file(s) have CONFLICT MARKERS — resolve them in the PR:`);
  conflicts.forEach((f) => console.log(`    ${f}`));
  console.log('  (These come from client-local edits overlapping the core change. CI will stay red until resolved.)');
}
console.log(`\n✅ ${layer}-core synced to ${version}. Review, then commit + open PR.`);
