# CSP Quick Reference Checklist

Use this when adding a new third-party integration to avoid silent failures.

---

## 5-Step Process

### ✅ Step 1: Identify Service Domains
From the service docs, list:
- [ ] Script CDN domains
- [ ] Iframe domains
- [ ] API/fetch domains
- [ ] Stylesheet domains (if any)
- [ ] Font CDN domains (if any)

### ✅ Step 2: Test Locally (CSP Disabled)
- [ ] Temporarily comment out CSP in `next.config.ts`
- [ ] `npm run build && npm run start`
- [ ] Verify service works
- [ ] Restore CSP

### ✅ Step 3: Update `frontend/next.config.ts`
- [ ] Add to `script-src` if service loads scripts
- [ ] Add to `frame-src` if service uses iframes
- [ ] Add to `connect-src` if service makes fetch calls
- [ ] Add to `style-src` if service loads stylesheets
- [ ] Add to `font-src` if service loads fonts

Example:
```typescript
// In buildSecurityHeaders() function, line ~112-125
const connectSrc = [
  "'self'",
  apiPublicOrigin || "'self'",
  "https://api.razorpay.com",
  "https://new-service.com",  // ← Add here
].filter(Boolean).join(" ");

const csp = [
  ...
  "script-src 'self' 'unsafe-inline' ... https://new-service.com",  // ← Add here
  ...
];
```

### ✅ Step 4: Commit
```bash
git add frontend/next.config.ts
git commit -m "fix(csp): allow [Service Name] domains for [Feature]"
```

### ✅ Step 5: Test on VPS
- [ ] Rebuild: `npm run build`
- [ ] Restart: `pm2 restart raghava-organics-frontend --update-env`
- [ ] Open browser DevTools on production
- [ ] **Console tab:** Zero CSP violations ✅
- [ ] **Network tab:** Service requests successful ✅
- [ ] Feature works end-to-end ✅

---

## CSP Directive Quick Map

| Need This | Use This CSP Directive |
|-----------|------------------------|
| Script from CDN | `script-src` |
| Iframe (modal, widget, embed) | `frame-src` |
| API fetch, beacon, WebSocket | `connect-src` |
| External stylesheet | `style-src` |
| External font | `font-src` |
| Image CDN | `img-src` |
| Web Worker, Service Worker | `worker-src` |

---

## Common CSP Violations & Fixes

| Error in Console | Root Cause | Fix |
|---|---|---|
| `Executing inline script violates script-src` | Missing `'unsafe-inline'` | Add to `script-src` |
| `Framing '...' violates frame-src` | Domain not in `frame-src` | Add domain to `frame-src` |
| `Connecting to ... blocked` | Domain not in `connect-src` | Add domain to `connect-src` |
| `Refused to load stylesheet` | Domain not in `style-src` | Add domain to `style-src` |
| `Font refused: not allowed by Content-Security-Policy` | Domain not in `font-src` | Add domain to `font-src` |

---

## Verification Checklist

Before marking "done":

- [ ] `next.config.ts` edited (correct directives)
- [ ] Locally tested (CSP on, service works)
- [ ] VPS deployed (`npm run build && pm2 restart`)
- [ ] Production tested (DevTools Console clean)
- [ ] Network tab shows service requests ✅
- [ ] Feature works end-to-end ✅
- [ ] Git commit has descriptive message
- [ ] This guide updated with new service

---

## File Locations

- **CSP Config:** `frontend/next.config.ts` (line ~111)
- **Full Guide:** `frontend/docs/CSP_AND_THIRD_PARTY_INTEGRATION_GUIDE.md`
- **CLAUDE Rules:** `CLAUDE.md` (section 4.5)

---

## When Something Breaks

1. Open **DevTools Console** (right-click → Inspect → Console tab)
2. Look for `violates the following Content Security Policy directive`
3. Note the directive name (script-src, frame-src, connect-src, etc.)
4. Add the blocked domain to that directive in `next.config.ts`
5. Rebuild and restart

**Never assume it's working without checking the Console first.**

---

## Example: Razorpay Domains (Current)

Reference for comparison:

```typescript
// script-src: scripts can execute from ('unsafe-eval' is added in DEV ONLY for the Next.js dev runtime; never in prod)
`script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com`

// frame-src: iframes can load from
"frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com"

// connect-src: fetch/WebSocket can reach
"connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://cloudflareinsights.com"
```

---

**Last Updated:** June 14, 2026
