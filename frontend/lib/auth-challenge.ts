/**
 * Decides whether an auth form must present a bot challenge, and whether it is
 * even able to.
 *
 * Kept as a pure function (rather than living inside the React hook) because this
 * is the logic that failed in production: the storefront inferred "is a challenge
 * required?" from its own build-time `NEXT_PUBLIC_TURNSTILE_SITE_KEY` while the API
 * decided from `TURNSTILE_SECRET_KEY`. A deploy where only the API had its variable
 * rendered no widget, sent no token, and had every login, registration, phone OTP
 * and password reset rejected with "Challenge token is required" — with no error on
 * either side pointing at the cause. Logic this load-bearing needs tests, and tests
 * are cheap here and expensive inside a hook.
 *
 * The server's answer always wins; the build-time values are only a fallback for
 * backends that do not publish the contract yet.
 */

export interface AuthChallengeInput {
  /** `authChallenge.required` from GET /store/config; null while still loading. */
  serverRequired: boolean | null;
  /** `authChallenge.siteKey` from GET /store/config; null when not published. */
  serverSiteKey: string | null;
  /** Build-time fallback: whether this build considers Turnstile configured. */
  envConfigured: boolean;
  /** Build-time fallback site key. */
  envSiteKey: string | null;
  /** Current solved-challenge token, if any. */
  token: string | null;
}

export interface AuthChallengeState {
  required: boolean;
  /** Safe to submit: either no challenge is needed, or we hold a token. */
  ready: boolean;
  /** Contract not yet known — hold submit, but show no error. */
  configLoading: boolean;
  /** A challenge is required but no site key exists anywhere: submit cannot succeed. */
  misconfigured: boolean;
  siteKey: string | null;
}

export function resolveAuthChallengeState(input: AuthChallengeInput): AuthChallengeState {
  const configLoading = input.serverRequired === null;
  const required = input.serverRequired ?? input.envConfigured;
  const siteKey = input.serverSiteKey ?? input.envSiteKey;
  const misconfigured = !configLoading && required && !siteKey;

  return {
    required,
    // False while loading: submitting before the contract is known risks sending a
    // token-less request, which the API counts as a challenge FAILURE and which
    // locks the caller's IP after three — so an unlucky race would not just fail,
    // it would lock the user out.
    ready: configLoading ? false : !required || Boolean(input.token),
    configLoading,
    misconfigured,
    siteKey,
  };
}

/** User-facing copy for the misconfigured case — identical across every auth form. */
export const TURNSTILE_MISCONFIGURED_MESSAGE =
  "Sign-in is temporarily unavailable due to a security configuration issue. Please contact support.";
