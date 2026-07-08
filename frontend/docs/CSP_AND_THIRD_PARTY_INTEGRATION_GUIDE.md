# Content Security Policy (CSP) & Third-Party Integration Guide

**Last Updated:** June 2026

---

## Overview

This document explains the Content Security Policy (CSP) in this Next.js frontend and how to safely add new third-party integrations without breaking the site.

**Why CSP?** CSP is a security header that prevents XSS (cross-site scripting) attacks. But it can also silently block legitimate services if not configured correctly.

**Why Silent?** When CSP blocks a resource, the browser doesn't crash or show an error dialog — it just silently drops the request. The script doesn't load, the iframe doesn't render, or the API call fails with no visible indication. Only the **Console** and **Network** tabs reveal the problem.

---

## The June 2026 Incident

**Date:** June 14, 2026  
**Issue:** Entire frontend appeared broken on production VPS.

**Symptoms:**
- Add to Cart buttons did not work
- Admin login page stuck forever
- Ops page stuck forever
- Checkout page not loading
- Only server-rendered static pages worked

**Root Cause:** CSP `script-src` directive was missing `'unsafe-inline'`, blocking **all Next.js/Turbopack inline scripts**. These inline `<script>` tags carry React Server Component (RSC) payload data to the client for hydration. Without them, React never "woke up" — no event handlers, no effects, no fetch calls.

**Discovery Method:**
1. Open browser DevTools → **Console** tab
2. Saw 18+ CSP violation messages like:
   ```
   Executing inline script violates the following Content Security Policy directive: 
   "script-src 'self' https://checkout.razorpay.com".
   ```
3. Checked **Network** tab → 0 Fetch/XHR requests (confirming React didn't hydrate)
4. Only HTML + images loaded; no JavaScript executed

**Fix:** Updated `next.config.ts` line 125 from:
```javascript
// ❌ BROKEN
"script-src 'self' https://checkout.razorpay.com",

// ✅ FIXED
"script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com",
```

Also added missing domains to `frame-src` and `connect-src`.

---

## Current CSP Configuration

**Location:** `frontend/next.config.ts`, function `buildSecurityHeaders()` (line ~111-135)

```typescript
function buildSecurityHeaders(): Array<{ key: string; value: string }> {
  const connectSrc = [
    "'self'",
    apiPublicOrigin || "'self'",
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://cloudflareinsights.com",
  ].filter(Boolean).join(" ");

  const csp = [
    "default-src 'self'",
    `connect-src ${connectSrc}`,
    // 'unsafe-eval' is added in DEV ONLY (Next.js dev runtime / React Refresh); production omits it.
    `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    // Emitted in PRODUCTION ONLY — localhost dev is http, so upgrading would break dev.
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    // ... other headers
  ];
}
```

### What Each Directive Does

| Directive | Purpose | Current Value | Why |
|-----------|---------|---------------|-----|
| **`default-src`** | Fallback for all unspecified directives | `'self'` | Only trust same-origin by default |
| **`script-src`** | Which scripts can execute | `'self' 'unsafe-inline' https://checkout.razorpay.com ...` (+ `'unsafe-eval'` in dev only) | `'unsafe-inline'` required for Next.js RSC inline scripts; Razorpay/Cloudflare domains for payment + CAPTCHA. `'unsafe-eval'` is added **only in development** for the Next.js dev runtime / React Refresh — never in production |
| **`frame-src`** | Which iframes can load | `'self' https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com` | Razorpay payment modal + Turnstile CAPTCHA |
| **`connect-src`** | Where fetch/WebSocket can go | `'self' https://api.razorpay.com https://lumberjack.razorpay.com https://cloudflareinsights.com` | Analytics + risk detection callbacks |
| **`style-src`** | Where stylesheets come from | `'self' 'unsafe-inline'` | Tailwind runtime + component inline styles |
| **`img-src`** | Where images come from | `'self' https: data: blob:` | All HTTPS CDNs + R2 + base64 previews |
| **`font-src`** | Where fonts come from | `'self' data:` | Next.js self-hosts fonts; no external CDN |
| **`worker-src`** | Web Workers, Service Workers | `'self' blob:` | Not currently used, but future-proofed |
| **`form-action`** | Where forms submit | `'self'` | Only same-origin forms |
| **`upgrade-insecure-requests`** | Auto-upgrade HTTP to HTTPS | Enabled **in production only** | Browser tries HTTPS first on all requests. Omitted in dev because localhost is served over http |

---

## Currently Allowed Third-Party Services

### 1. Razorpay (Payment Gateway)
**Status:** ✅ Active and Tested  
**Domains Used:**
- `https://checkout.razorpay.com` — Payment modal UI
- `https://cdn.razorpay.com` — Risk detection bundle (`razorpay-risk-detection/bundle.js`)
- `https://api.razorpay.com` — Risk detection API + payment iframe

**CSP Lines:**
- `script-src`: `https://checkout.razorpay.com https://cdn.razorpay.com`
- `frame-src`: `https://checkout.razorpay.com https://api.razorpay.com`
- `connect-src`: `https://api.razorpay.com https://lumberjack.razorpay.com`

**Implementation:** [frontend/app/(storefront)/checkout/payment/page.tsx](../app/(storefront)/checkout/payment/page.tsx)

**Test Flow:**
1. Visit `/checkout`
2. Click "Proceed to Pay"
3. Razorpay modal should open
4. Browser Network tab should show requests to `api.razorpay.com` ✅
5. Console should have NO CSP violation messages ✅

---

### 2. Cloudflare Turnstile (CAPTCHA)
**Status:** ✅ Active and Tested  
**Domains Used:**
- `https://challenges.cloudflare.com` — Turnstile widget script + iframe

**CSP Lines:**
- `script-src`: `https://challenges.cloudflare.com`
- `frame-src`: `https://challenges.cloudflare.com`

**Implementation:** [frontend/components/auth/TurnstileChallenge.tsx](../components/auth/TurnstileChallenge.tsx)

**Test Flow:**
1. Visit `/login` or `/register` (if Turnstile enabled)
2. CAPTCHA widget should render
3. Browser Network tab should show `api.js?render=explicit` ✅
4. Console should have NO CSP violation messages ✅

**Config:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `.env.production.local`

---

### 3. Cloudflare Insights (Analytics)
**Status:** ✅ Active (Auto-Injected)  
**Domains Used:**
- `https://static.cloudflareinsights.com` — Analytics beacon script
- `https://cloudflareinsights.com` — Analytics event delivery

**CSP Lines:**
- `script-src`: `https://static.cloudflareinsights.com`
- `connect-src`: `https://cloudflareinsights.com`

**Implementation:** Auto-injected by Cloudflare (not in our code)

**Test Flow:**
1. Open any page
2. Browser Console may show: `Tracking Prevention blocked a Script resource from loading` (this is **browser feature, not CSP — OK to ignore**)
3. Network tab should show requests to `cloudflareinsights.com` ✅ (may be blocked by browser privacy, but CSP allows it)
4. Console should have NO CSP violation messages ✅

---

## How to Add a New Third-Party Integration

### Step 1: Gather Service Requirements

Check the service's documentation for:
- **Scripts:** List of CDN domains that serve scripts
- **Iframes:** Does it load an iframe? From which domain?
- **API Calls:** Does it make fetch requests? To which domain?
- **Styles:** Does it load stylesheets? From which domain?
- **Fonts:** Does it load custom fonts? From which domain?
- **Images:** Does it load images? From which domain?

**Example: Google Analytics**
- Scripts: `https://www.googletagmanager.com/` (GTM script)
- Fetch: `https://www.google-analytics.com/` (ping beacon)
- Iframes: None
- Fonts: None

### Step 2: Test Locally with CSP Disabled

Temporarily disable CSP in `next.config.ts` to verify the service works:

```typescript
// In next.config.ts, temporarily comment out:
async headers() {
  return []; // Empty — no CSP headers
}
```

Then rebuild and test:
```bash
npm run build
npm run start
```

Verify the service loads and functions. Once working, restore the CSP header.

### Step 3: Update `frontend/next.config.ts`

Add the domains to the appropriate CSP directives.

**Example: Adding Google Analytics**

```typescript
// Before: only Razorpay + Cloudflare
const connectSrc = [
  "'self'",
  apiPublicOrigin || "'self'",
  "https://api.razorpay.com",
  "https://lumberjack.razorpay.com",
  "https://cloudflareinsights.com",
].filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  `connect-src ${connectSrc}`,
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  // ...
];

// After: add Google Analytics domains
const connectSrc = [
  "'self'",
  apiPublicOrigin || "'self'",
  "https://api.razorpay.com",
  "https://lumberjack.razorpay.com",
  "https://cloudflareinsights.com",
  "https://www.google-analytics.com",      // ← Add here
  "https://www.googletagmanager.com",      // ← Add here
].filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  `connect-src ${connectSrc}`,
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com https://www.googletagmanager.com",  // ← Add here
  // ...
];
```

### Step 4: Commit and Document

```bash
git add frontend/next.config.ts
git commit -m "fix(csp): allow Google Analytics domains for event tracking

- Added https://www.google-analytics.com to connect-src
- Added https://www.googletagmanager.com to script-src and connect-src

Tracking events now send successfully without CSP violations."
```

### Step 5: Deploy and Test on VPS

After deploying:

```bash
# On VPS, rebuild and restart
cd /var/www/raghava-organics/frontend
npm run build
pm2 restart raghava-organics-frontend --update-env
```

Then test on the live VPS:

```bash
# In browser DevTools Console on production:
# Should see NO "violates ... Content Security Policy" messages
```

### Step 6: Update This Document

Add the service to the **Currently Allowed Third-Party Services** table above.

---

## Debugging CSP Violations

### Symptom 1: Script doesn't load / React doesn't hydrate

**Console Message:**
```
Executing inline script violates the following Content Security Policy directive: 
"script-src 'self' https://...". Either the 'unsafe-inline' keyword, a hash 
('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution.
```

**Fix:** Add `'unsafe-inline'` to `script-src` (already done for this project). If you want to remove it later, you'd need to implement nonce-based CSP, which is complex.

---

### Symptom 2: Payment modal doesn't open

**Console Message:**
```
Framing 'https://checkout.razorpay.com/v1/checkout' violates the following 
Content Security Policy directive: "frame-src 'self' https://..."
```

**Fix:** Add `https://checkout.razorpay.com` to `frame-src`.

---

### Symptom 3: Analytics events don't send

**Console Message:**
```
Connecting to the server at 'https://www.google-analytics.com' was blocked because 
this document's Content Security Policy does not allow that destination.
```

**Fix:** Add `https://www.google-analytics.com` to `connect-src`.

---

### Symptom 4: Stylesheet or font fails to load

**Console Message:**
```
Refused to load the stylesheet '...' because it violates the Content Security Policy 
directive: "style-src 'self'..."
```

**Fix:** Either add the domain to `style-src`, or use `'unsafe-inline'` (less secure).

---

## Testing Checklist Before Going Live

After adding a new third-party integration, test ALL of these:

- [ ] **Incognito/Private browsing** — Cache shouldn't interfere
- [ ] **Console tab** — Zero CSP violation messages
- [ ] **Network tab** — Service requests visible and successful (200-level status)
- [ ] **Functionality** — Feature works end-to-end
- [ ] **Mobile viewport** — Test on phone/tablet too
- [ ] **Localhost** — Test locally before pushing
- [ ] **Staging VPS** — Test on staging before production
- [ ] **Production VPS** — Test on live domain

---

## CSP Nonce Pattern (Advanced)

If you want to remove `'unsafe-inline'` from CSP for maximum security, you can use **nonce-based CSP**. This is more complex but more secure.

**How It Works:**
1. Generate a random nonce (random string) on the server
2. Add it to all inline `<script>` tags: `<script nonce="random-string">`
3. Allow only scripts with that nonce in CSP: `script-src 'nonce-random-string'`
4. Browser checks the nonce matches before executing

**Current Project:** Uses `'unsafe-inline'` for simplicity. Nonce pattern is beyond scope unless explicitly requested.

---

## References

- **MDN CSP Guide:** https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- **OWASP CSP Cheat Sheet:** https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- **Next.js Security:** https://nextjs.org/docs/app/building-your-application/configuring/headers#content-security-policy

---

**Last Updated:** June 14, 2026  
**Status:** Production-ready, incident-response documented
