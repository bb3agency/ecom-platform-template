/**
 * Admin list filters live in the URL (`/admin/orders?status=CONFIRMED`) so that
 * dashboard links land pre-filtered, and a refresh or Back keeps what you were
 * looking at. Pure helpers — the hook in hooks/use-url-filter-state.ts wires them up.
 */

/** Read one filter value, restricted to an allow-list when given (unknown values → fallback). */
export function readFilterParam(
  search: string,
  key: string,
  fallback: string,
  allowed?: readonly string[],
): string {
  const value = new URLSearchParams(search).get(key);
  if (value === null || value === "") return fallback;
  if (allowed && !allowed.includes(value)) return fallback;
  return value;
}

/**
 * Return `href` with `key` set to `value`, or removed when the value equals the
 * default (keeps URLs short and shareable). Other params and the hash are preserved.
 */
export function writeFilterParam(href: string, key: string, value: string, defaultValue: string): string {
  const url = new URL(href);
  if (value === defaultValue || value === "") {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
