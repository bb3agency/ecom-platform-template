import { describe, expect, it } from "vitest";
import { resolveAuthChallengeState, type AuthChallengeInput } from "./auth-challenge";

function input(overrides: Partial<AuthChallengeInput> = {}): AuthChallengeInput {
  return {
    serverRequired: false,
    serverSiteKey: null,
    envConfigured: false,
    envSiteKey: null,
    token: null,
    ...overrides,
  };
}

describe("resolveAuthChallengeState", () => {
  it("holds submit until the server's contract is known", () => {
    const state = resolveAuthChallengeState(input({ serverRequired: null }));
    expect(state.configLoading).toBe(true);
    expect(state.ready).toBe(false);
    // Nothing to complain about yet — we simply do not know.
    expect(state.misconfigured).toBe(false);
  });

  it("flags the production outage: server requires a challenge, no site key anywhere", () => {
    // The exact raghava-organics state on 2026-08-15 — API had TURNSTILE_SECRET_KEY,
    // the storefront build had no site key, so every auth request 400'd.
    const state = resolveAuthChallengeState(
      input({ serverRequired: true, serverSiteKey: null, envConfigured: false, envSiteKey: null }),
    );
    expect(state.misconfigured).toBe(true);
    expect(state.required).toBe(true);
    // Must NOT submit: the API counts a token-less request as a challenge failure
    // and locks the IP after three, so retrying escalates into a lockout.
    expect(state.ready).toBe(false);
  });

  it("uses the server-published site key, ignoring a stale build-time one", () => {
    const state = resolveAuthChallengeState(
      input({ serverRequired: true, serverSiteKey: "0xSERVER", envSiteKey: "0xSTALE_BUILD" }),
    );
    expect(state.siteKey).toBe("0xSERVER");
    expect(state.misconfigured).toBe(false);
  });

  it("falls back to the build-time site key when the backend publishes none", () => {
    // Backends older than the contract send siteKey: null — deployments configured
    // the old way must keep working.
    const state = resolveAuthChallengeState(
      input({ serverRequired: true, serverSiteKey: null, envConfigured: true, envSiteKey: "0xENV" }),
    );
    expect(state.siteKey).toBe("0xENV");
    expect(state.misconfigured).toBe(false);
    expect(state.ready).toBe(false); // still needs a solved token
  });

  it("becomes ready once the challenge is solved", () => {
    const state = resolveAuthChallengeState(
      input({ serverRequired: true, serverSiteKey: "0xSERVER", token: "solved-token" }),
    );
    expect(state.ready).toBe(true);
    expect(state.misconfigured).toBe(false);
  });

  it("is ready immediately when the server requires no challenge", () => {
    const state = resolveAuthChallengeState(input({ serverRequired: false, envConfigured: true }));
    // Server wins over the build's own opinion — otherwise a storefront with a site
    // key would demand a challenge an API that does not check one, blocking sign-in.
    expect(state.required).toBe(false);
    expect(state.ready).toBe(true);
  });

  it("falls back to the build-time answer when /store/config is unreachable", () => {
    // serverRequired stays null only while loading; the caller passes envConfigured
    // once the fetch fails, so an unrelated config outage must not block sign-in.
    const state = resolveAuthChallengeState(
      input({ serverRequired: false, envConfigured: true, envSiteKey: "0xENV" }),
    );
    expect(state.ready).toBe(true);
  });
});
