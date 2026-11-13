/**
 * Prisma connection-pool sizing guidance.
 *
 * Without `connection_limit` Prisma sizes its pool as `num_cpus * 2 + 1`, which
 * on a shared VPS (API + workers + other clients on one Postgres) can exhaust
 * `max_connections` under load. Production should set it explicitly, e.g.
 * `postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=20`.
 *
 * This is advisory only: it returns a warning message, never throws, so a
 * missing parameter cannot block startup.
 */
export const DATABASE_POOL_WARNING_EXAMPLE = '?connection_limit=10&pool_timeout=20';

export function getDatabasePoolWarning(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined
): string | null {
  if ((nodeEnv ?? '').trim().toLowerCase() !== 'production') return null;
  const url = (databaseUrl ?? '').trim();
  if (!url) return null;

  let hasConnectionLimit: boolean;
  try {
    hasConnectionLimit = new URL(url).searchParams.has('connection_limit');
  } catch {
    // Unparseable URL (e.g. unencoded special characters) — fall back to a text check.
    hasConnectionLimit = /[?&]connection_limit=/.test(url);
  }
  if (hasConnectionLimit) return null;

  return (
    'DATABASE_URL has no connection_limit — Prisma will size its pool from the CPU count. ' +
    `Set it explicitly for production (e.g. append ${DATABASE_POOL_WARNING_EXAMPLE}); ` +
    'see ENV_VS_DB_CONFIG_REFERENCE.md "Prisma connection pool sizing".'
  );
}

export function warnIfDatabasePoolUnsized(
  log: { warn: (obj: object, msg: string) => void },
  component: string,
  env: Record<string, string | undefined> = process.env
): void {
  const warning = getDatabasePoolWarning(env.DATABASE_URL, env.NODE_ENV);
  if (warning) {
    log.warn({ component }, warning);
  }
}
