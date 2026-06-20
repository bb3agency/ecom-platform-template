import { describe, expect, it, vi } from 'vitest';
import {
  attachRedisErrorListener,
  guardRedisDuplicate,
  installGuardedIORedisDuplicate,
  isTransientRedisError,
  waitForRedisReady
} from './redis-connection';

describe('redis-connection', () => {
  it('classifies transient redis network errors', () => {
    expect(isTransientRedisError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientRedisError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientRedisError(new Error('other'))).toBe(false);
  });

  it('throttles repeated transient errors', () => {
    vi.useFakeTimers();

    const warn = vi.fn();
    const error = vi.fn();
    const listeners: { error: Array<(err: Error) => void> } = { error: [] };
    const client = {
      on: (event: 'error', listener: (err: Error) => void) => {
        listeners[event].push(listener);
      }
    };

    attachRedisErrorListener(client, { warn, error }, 'test-client', { throttleMs: 1_000 });

    const emit = () => {
      for (const listener of listeners.error) {
        listener(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
      }
    };

    emit();
    emit();
    emit();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    emit();

    expect(warn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('guards duplicated clients with error listeners', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const duplicateListeners: { error: Array<(err: Error) => void> } = { error: [] };
    const duplicate = {
      on: (event: 'error', listener: (err: Error) => void) => {
        duplicateListeners[event].push(listener);
      },
      duplicate: () => duplicate
    };

    const guarded = guardRedisDuplicate(duplicate, { warn, error }, 'duplicate-client');

    expect(guarded).toBe(duplicate);
    expect(duplicateListeners.error).toHaveLength(1);

    for (const listener of duplicateListeners.error) {
      listener(new Error('boom'));
    }

    expect(error).toHaveBeenCalledTimes(1);
  });

  it('waits for redis ready when not connected yet', async () => {
    let readyListener: (() => void) | undefined;
    const client = {
      status: 'connecting',
      on: vi.fn(),
      once: (_event: 'ready', listener: () => void) => {
        readyListener = listener;
      },
      off: vi.fn()
    };

    const readyPromise = waitForRedisReady(client, 50);
    readyListener?.();
    await expect(readyPromise).resolves.toBeUndefined();
  });

  it('patches ioredis duplicate to attach error listeners', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const duplicateListeners: { error: Array<(err: Error) => void> } = { error: [] };
    const RedisClass = {
      prototype: {
        duplicate: vi.fn(function duplicate(this: unknown) {
          return {
            on: (event: 'error', listener: (err: Error) => void) => {
              duplicateListeners[event].push(listener);
            }
          };
        })
      }
    };

    installGuardedIORedisDuplicate(RedisClass, { warn, error });
    RedisClass.prototype.duplicate.call({});

    expect(duplicateListeners.error).toHaveLength(1);
  });

  it('does not attach duplicate error listeners twice', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const listeners: { error: Array<(err: Error) => void> } = { error: [] };
    const client = {
      on: (event: 'error', listener: (err: Error) => void) => {
        listeners[event].push(listener);
      },
      duplicate: () => client
    };

    attachRedisErrorListener(client, { warn, error }, 'first');
    attachRedisErrorListener(client, { warn, error }, 'second');

    expect(listeners.error).toHaveLength(1);
  });
});
