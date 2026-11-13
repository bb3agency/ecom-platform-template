/**
 * Single-flight guard for admin mutations.
 *
 * A React `busy` state is not enough on its own: two clicks in the same tick both
 * read the stale `busy === null` closure and both fire. The gate is synchronous,
 * so the second `run` resolves to `{ ok: false, reason: "busy" }` without calling
 * the request at all (each attempt mints its own idempotency key, so the backend
 * would otherwise create two notes).
 */
export type MutationGateResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "error"; error: unknown };

export interface MutationGate {
  readonly active: string | null;
  run: <T>(key: string, task: () => Promise<T>) => Promise<MutationGateResult<T>>;
}

export function createMutationGate(onChange?: (active: string | null) => void): MutationGate {
  let active: string | null = null;
  const set = (next: string | null) => {
    active = next;
    onChange?.(next);
  };
  return {
    get active() {
      return active;
    },
    async run(key, task) {
      if (active !== null) return { ok: false, reason: "busy" };
      set(key);
      try {
        return { ok: true, value: await task() };
      } catch (error) {
        return { ok: false, reason: "error", error };
      } finally {
        set(null);
      }
    },
  };
}
