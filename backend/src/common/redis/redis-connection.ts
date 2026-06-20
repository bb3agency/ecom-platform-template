export const TRANSIENT_REDIS_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'ECONNABORTED',
  'EAI_AGAIN'
]);

const guardedClients = new WeakSet<object>();

export type RedisLogLike = {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type RedisEventClient = {
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
};

type RedisReadyClient = RedisEventClient & {
  status: string;
  once(event: 'ready', listener: () => void): unknown;
  off(event: 'ready', listener: () => void): unknown;
};

type RedisErrorListenerOptions = {
  throttleMs?: number;
  onPersistentError?: (err: Error) => void;
};

type IORedisDuplicateClass = {
  prototype: {
    duplicate: (override?: Record<string, unknown>) => unknown;
  };
};

let guardedDuplicatePatchInstalled = false;

export function buildStandardRedisOptions(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    maxRetriesPerRequest: null,
    keepAlive: 5_000,
    connectTimeout: 15_000,
    enableOfflineQueue: true,
    family: 4,
    retryStrategy: (times: number) => Math.min(times * 300, 3_000),
    reconnectOnError: () => true,
    ...overrides
  };
}

export function isTransientRedisError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const code =
    'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string'
      ? (err as NodeJS.ErrnoException).code
      : undefined;

  return code ? TRANSIENT_REDIS_ERROR_CODES.has(code) : false;
}

export function attachRedisErrorListener(
  client: RedisEventClient,
  log: RedisLogLike,
  context: string,
  options: RedisErrorListenerOptions = {}
): void {
  const marked = client as object;
  if (guardedClients.has(marked)) {
    return;
  }
  guardedClients.add(marked);

  const throttleMs = options.throttleMs ?? 10_000;
  let lastLogAt = 0;
  let suppressed = 0;

  client.on('error', (...args: unknown[]) => {
    const err = args[0] instanceof Error ? args[0] : new Error(String(args[0]));
    const transient = isTransientRedisError(err);
    const now = Date.now();

    if (transient && now - lastLogAt < throttleMs) {
      suppressed += 1;
      return;
    }

    if (suppressed > 0) {
      log.warn(
        { context, suppressedTransientErrors: suppressed },
        'Suppressed repeated transient Redis connection errors'
      );
      suppressed = 0;
    }

    lastLogAt = now;

    const payload = {
      err: err.message,
      code:
        'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string'
          ? (err as NodeJS.ErrnoException).code
          : undefined,
      context
    };

    if (transient) {
      log.warn(payload, 'Redis connection error (will retry)');
      return;
    }

    log.error(payload, 'Redis client error');
    options.onPersistentError?.(err);
  });
}

export function guardRedisDuplicate<T extends RedisEventClient>(
  client: T & { duplicate(): T },
  log: RedisLogLike,
  context: string,
  options: RedisErrorListenerOptions = {}
): T {
  const duplicate = client.duplicate();
  attachRedisErrorListener(duplicate, log, context, options);
  return duplicate;
}

/**
 * BullMQ Workers call `duplicate()` internally for blocking connections.
 * Patch once at worker boot so those connections always have error listeners.
 */
export function installGuardedIORedisDuplicate(
  redisClass: IORedisDuplicateClass,
  log: RedisLogLike,
  options: RedisErrorListenerOptions = {}
): void {
  if (guardedDuplicatePatchInstalled) {
    return;
  }
  guardedDuplicatePatchInstalled = true;

  const originalDuplicate = redisClass.prototype.duplicate;
  let duplicateCounter = 0;

  redisClass.prototype.duplicate = function duplicateWithErrorGuard(
    this: RedisEventClient,
    override?: Record<string, unknown>
  ) {
    const duplicate = originalDuplicate.call(this, override) as RedisEventClient;
    duplicateCounter += 1;
    attachRedisErrorListener(duplicate, log, `ioredis-duplicate-${duplicateCounter}`, options);
    return duplicate;
  };
}

export async function waitForRedisReady(client: RedisReadyClient, timeoutMs = 20_000): Promise<void> {
  if (client.status === 'ready') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      client.off('ready', onReady);
      reject(new Error(`Redis did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    client.once('ready', onReady);
  });
}
