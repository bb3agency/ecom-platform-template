import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Behavioural tests for `resolve_nginx_live_conf` (scripts/lib/resolve-nginx-live-conf.sh),
 * run through real bash against real directory fixtures.
 *
 * Regression origin (2026-08-10): the resolver only matched filenames ending in `.conf`,
 * but Debian/Ubuntu's nginx convention — used by every live client VPS — has NO extension
 * (`/etc/nginx/sites-available/raghavaorganics.com`). Resolution therefore always fell
 * through to the "first deploy" default, so nginx drift detection silently never fired:
 * edge-config fixes deployed green and were never applied. Worse, with NGINX_AUTO_RELOAD=1
 * the script would have created a SECOND vhost for the same server_name.
 */

const scriptPath = path.resolve(__dirname, '../../../scripts/lib/resolve-nginx-live-conf.sh');
const tempRoots: string[] = [];

/** Windows paths must be handed to Git Bash in POSIX form (`D:\x` -> `/d/x`). */
function toPosix(target: string): string {
  const normalized = target.split(path.sep).join('/');
  return /^[A-Za-z]:/.test(normalized)
    ? `/${normalized[0]!.toLowerCase()}${normalized.slice(2)}`
    : normalized;
}

/** Expected resolver output for a file inside the fixture root. */
function at(root: string, ...segments: string[]): string {
  return [toPosix(root), ...segments].join('/');
}

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'nginx-fixture-'));
  tempRoots.push(root);
  mkdirSync(path.join(root, 'sites-available'), { recursive: true });
  mkdirSync(path.join(root, 'sites-enabled'), { recursive: true });
  return root;
}

/**
 * A bash that can read this repo's files. On Windows a bare `bash` may resolve to WSL's
 * (System32\bash.exe), which cannot see `/d/...` Git-Bash-style paths — so probe the
 * candidates and pick one that actually works. Linux/CI resolves `bash` on the first try.
 */
const bashCommand = ((): string | null => {
  const candidates =
    process.platform === 'win32'
      ? ['bash', 'C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']
      : ['bash'];
  for (const candidate of candidates) {
    try {
      const probe = execFileSync(candidate, ['-c', `test -f "${toPosix(scriptPath)}" && echo ok`], {
        encoding: 'utf8'
      });
      if (probe.trim() === 'ok') return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
})();

function resolve(root: string, domain: string, project: string): string {
  const out = execFileSync(
    bashCommand!,
    ['-c', `. "${toPosix(scriptPath)}"; resolve_nginx_live_conf "${domain}" "${project}"`],
    { env: { ...process.env, NGINX_ROOT: toPosix(root) }, encoding: 'utf8' }
  );
  return out.trim();
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

// Never silently skipped in CI: Linux always finds a usable bash, so the guard only
// relaxes a local Windows box whose `bash` is WSL and cannot read the repo path.
describe.skipIf(bashCommand === null)('resolve_nginx_live_conf', () => {
  it('finds the EXTENSION-LESS vhost used by the live client VPSes', () => {
    // Exact layout on the shared box: two clients, no .conf suffix, plus .bak files.
    const root = makeRoot();
    for (const name of [
      'raghavaorganics.com',
      'raghavaorganics.com.bak',
      'srisaibabasweets.com',
      'srisaibabasweets.com.bak',
      'default'
    ]) {
      writeFileSync(path.join(root, 'sites-available', name), 'server {}\n');
    }
    // sites-enabled entry: a plain file stands in for the symlink nginx would use
    // (the resolver only tests for a regular file, and Windows symlinks need privileges).
    writeFileSync(path.join(root, 'sites-enabled', 'raghavaorganics.com'), 'server {}\n');

    const resolved = resolve(root, 'raghavaorganics.com', 'raghava-organics');
    expect(resolved).toBe(at(root, 'sites-enabled', 'raghavaorganics.com'));
    // The pre-fix behaviour — inventing a non-existent `<domain>.conf` — must not return.
    expect(resolved.endsWith('.conf')).toBe(false);
  });

  it('still finds a .conf vhost when the box uses that convention', () => {
    const root = makeRoot();
    writeFileSync(path.join(root, 'sites-available', 'shop.example.com.conf'), 'server {}\n');
    expect(resolve(root, 'shop.example.com', 'shop')).toBe(
      at(root, 'sites-available', 'shop.example.com.conf')
    );
  });

  it('prefers a project-named file over a domain-named one', () => {
    const root = makeRoot();
    writeFileSync(path.join(root, 'sites-available', 'my-client'), 'server {}\n');
    writeFileSync(path.join(root, 'sites-available', 'shop.example.com'), 'server {}\n');
    expect(resolve(root, 'shop.example.com', 'my-client')).toBe(
      at(root, 'sites-available', 'my-client')
    );
  });

  it('discovers an oddly-named vhost by its server_name, extension or not', () => {
    const root = makeRoot();
    writeFileSync(
      path.join(root, 'sites-available', '020-legacy-site'),
      'server {\n  server_name shop.example.com www.shop.example.com;\n}\n'
    );
    expect(resolve(root, 'shop.example.com', 'unrelated-project')).toBe(
      at(root, 'sites-available', '020-legacy-site')
    );
  });

  it('does not mistake a different domain that merely shares a suffix', () => {
    const root = makeRoot();
    writeFileSync(
      path.join(root, 'sites-available', 'other'),
      'server {\n  server_name notshop.example.com;\n}\n'
    );
    // No match → deterministic first-deploy default (extension-less: no .conf on this box).
    expect(resolve(root, 'shop.example.com', 'shop')).toBe(
      at(root, 'sites-available', 'shop.example.com')
    );
  });

  it('follows the box convention on a genuine first deploy', () => {
    const conf = makeRoot();
    writeFileSync(path.join(conf, 'sites-available', 'existing-site.conf'), 'server {}\n');
    expect(resolve(conf, 'new.example.com', 'new')).toBe(
      at(conf, 'sites-available', 'new.example.com.conf')
    );

    const bare = makeRoot();
    writeFileSync(path.join(bare, 'sites-available', 'existing-site'), 'server {}\n');
    expect(resolve(bare, 'new.example.com', 'new')).toBe(
      at(bare, 'sites-available', 'new.example.com')
    );
  });
});
