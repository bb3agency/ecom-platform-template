import { describe, expect, it, vi } from 'vitest';
import { getDatabasePoolWarning, warnIfDatabasePoolUnsized } from './database-pool';

const BASE = 'postgresql://app:secret@127.0.0.1:5432/shop';

describe('getDatabasePoolWarning', () => {
  it('warns in production when DATABASE_URL has no connection_limit', () => {
    const warning = getDatabasePoolWarning(BASE, 'production');
    expect(warning).toContain('connection_limit');
    expect(warning).toContain('?connection_limit=10&pool_timeout=20');
  });

  it('does not warn when connection_limit is set', () => {
    expect(getDatabasePoolWarning(`${BASE}?connection_limit=10&pool_timeout=20`, 'production')).toBeNull();
    expect(getDatabasePoolWarning(`${BASE}?schema=public&connection_limit=5`, 'production')).toBeNull();
  });

  it('only checks production', () => {
    expect(getDatabasePoolWarning(BASE, 'development')).toBeNull();
    expect(getDatabasePoolWarning(BASE, 'test')).toBeNull();
    expect(getDatabasePoolWarning(BASE, undefined)).toBeNull();
  });

  it('never throws on an unparseable or missing URL', () => {
    expect(getDatabasePoolWarning(undefined, 'production')).toBeNull();
    expect(getDatabasePoolWarning('not a url', 'production')).toContain('connection_limit');
    expect(getDatabasePoolWarning('not a url?connection_limit=4', 'production')).toBeNull();
  });

  it('does not leak the URL (credentials) into the warning', () => {
    expect(getDatabasePoolWarning(BASE, 'production')).not.toContain('secret');
  });
});

describe('warnIfDatabasePoolUnsized', () => {
  it('logs a warning (never throws) when the pool is unsized in production', () => {
    const log = { warn: vi.fn() };
    expect(() =>
      warnIfDatabasePoolUnsized(log, 'api', { NODE_ENV: 'production', DATABASE_URL: BASE })
    ).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith({ component: 'api' }, expect.stringContaining('connection_limit'));
  });

  it('stays quiet when sized', () => {
    const log = { warn: vi.fn() };
    warnIfDatabasePoolUnsized(log, 'workers', {
      NODE_ENV: 'production',
      DATABASE_URL: `${BASE}?connection_limit=10`
    });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
