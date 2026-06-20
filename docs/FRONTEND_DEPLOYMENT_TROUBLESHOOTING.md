# Frontend Deployment Troubleshooting Guide

## Quick Health Check (after deployment)

```bash
# SSH to VPS first
ssh d_user@raghavaorganics.com

# Check backend is accessible
curl -s http://127.0.0.1:3001/api/v1/health | jq .

# Check frontend is running
curl -s http://127.0.0.1:3101/ | head -10

# Check PM2 status
pm2 list
pm2 describe raghava-organics-frontend
```

---

## Common Deployment Failures

### ❌ "Cannot find module './image-optimizer'"

**Symptom:** Frontend crashes on startup after deployment, PM2 shows `error` status.

**Root cause:** Corrupted `.next` directory (stale cache, incomplete build, or race condition in npm).

**Fix:**
```bash
cd /var/www/raghava-organics/frontend

# 1. Stop the process
pm2 stop raghava-organics-frontend

# 2. Clean everything
rm -rf .next node_modules/.cache .next.old

# 3. Fresh build
npm ci --prefer-offline
npm run build

# 4. Verify build succeeded
ls -l .next/BUILD_ID  # Must exist

# 5. Restart
pm2 start npm --name raghava-organics-frontend -- start -- -p 3101

# 6. Health check
sleep 5
curl http://127.0.0.1:3101/
```

---

### ❌ "Failed to find Server Action 'x'"

**Symptom:** Frontend loads but buttons/forms fail with "Server Action not found" in browser console.

**Root cause:** Stale `.next` build (build was from before code change). Likely SKIP_FRONTEND_BUILD=true was used when it shouldn't have.

**Fix:**
```bash
cd /var/www/raghava-organics/frontend

# 1. Force full rebuild (don't skip)
pm2 stop raghava-organics-frontend
rm -rf .next node_modules/.cache
npm ci --prefer-offline
npm run build
pm2 restart raghava-organics-frontend

# 2. Clear browser cache: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

# 3. If still broken, purge CloudFlare:
# - Go to cloudflare.com → Caching → Purge Cache → Purge Everything
```

---

### ❌ "Connection refused: 127.0.0.1:3001"

**Symptom:** Frontend loads but API calls fail; browser console shows "Failed to connect to 127.0.0.1:3001".

**Root cause:** Backend is down, port is not listening, or firewall blocks internal traffic.

**Fix:**
```bash
# 1. Check backend is running
docker ps | grep backend

# 2. Check port 3001 is listening
ss -tlnp | grep 3001

# 3. If not, restart backend
cd /var/www/raghava-organics/backend
docker compose restart backend

# 4. Wait and verify
sleep 5
curl http://127.0.0.1:3001/api/v1/health
```

---

### ❌ PM2 shows "stop" or "inactive"

**Symptom:** `pm2 list` shows the frontend process with status "stopped" or "inactive".

**Fix:**
```bash
# Restart it
pm2 restart raghava-organics-frontend

# Or if not registered, start it
STOREFRONT_PORT=3101
pm2 start npm --name raghava-organics-frontend -- start -- -p $STOREFRONT_PORT
pm2 save
pm2 startup

# Verify
pm2 describe raghava-organics-frontend
```

---

### ❌ "npm ERR! code E404"

**Symptom:** Deployment fails at `npm ci` with 404 error for a package.

**Root cause:** Package registry rate limit, offline, or stale cache.

**Fix:**
```bash
cd /var/www/raghava-organics/frontend

# Clear cache
npm cache clean --force

# Try again with no-audit flag
npm ci --prefer-offline --no-audit

# If still fails, use legacy registry
npm config set registry https://registry.npmjs.org/
npm ci
```

---

### ❌ "ENOSPC: no space left on device"

**Symptom:** Build fails with disk full error.

**Fix:**
```bash
# Check disk space
df -h /var/www/raghava-organics

# Clean up old builds and caches
cd /var/www/raghava-organics/frontend
rm -rf .next.old node_modules/.cache
npm cache clean --force

# If still full, check other locations
du -sh /var/www/raghava-organics/*
du -sh /var/log/*

# Remove old Docker images/containers if needed
docker system prune -a
```

---

### ❌ Browser still shows old UI after deployment

**Symptom:** New code deployed but browser still shows old interface.

**Root cause:** Browser cache, CloudFlare cache, or stale build on VPS.

**Fix:**
```bash
# 1. Clear browser cache
# - Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
# - Or open DevTools → Settings → Disable cache (then reload)

# 2. If still old, purge CloudFlare
# - CloudFlare dashboard → Caching → Purge Cache → Purge Everything

# 3. Verify VPS has new build
cd /var/www/raghava-organics/frontend
cat .last-frontend-build-sha  # Should match latest git SHA
git log -1 --oneline

# 4. If shas don't match, rebuild
npm run build
pm2 restart raghava-organics-frontend
```

---

### ❌ "NEXT_PUBLIC_API_BASE_URL is not set"

**Symptom:** Build fails with "NEXT_PUBLIC_API_BASE_URL is not set" error.

**Root cause:** `.env.production.local` is missing or incomplete.

**Fix:**
```bash
cd /var/www/raghava-organics/frontend

# Verify env file exists and has required vars
cat .env.production.local | grep -E "NEXT_PUBLIC|INTERNAL_API"

# Must include:
# NEXT_PUBLIC_API_BASE_URL=https://raghavaorganics.com/api/v1
# NEXT_PUBLIC_STOREFRONT_URL=https://raghavaorganics.com
# INTERNAL_API_BASE_URL=http://127.0.0.1:3001/api/v1

# If missing, copy from template
cp .env.production.example .env.production.local

# Edit and fill in values
nano .env.production.local

# Rebuild
npm run build
pm2 restart raghava-organics-frontend
```

---

## Deployment Health Check Script

Save this as `scripts/health-check.sh` and run after every deploy:

```bash
#!/bin/bash
set -e

echo "=== Frontend Deployment Health Check ==="
echo ""

FE_PATH="/var/www/raghava-organics/frontend"
FE_PORT=3101

echo "1. ✓ Checking backend..."
if curl -s http://127.0.0.1:3001/api/v1/health | jq . >/dev/null 2>&1; then
  echo "   Backend: OK"
else
  echo "   ❌ Backend: DOWN"
  exit 1
fi

echo ""
echo "2. ✓ Checking frontend process..."
if pm2 describe raghava-organics-frontend >/dev/null 2>&1; then
  PM2_STATUS=$(pm2 describe raghava-organics-frontend | grep "status" | awk '{print $NF}')
  echo "   PM2: $PM2_STATUS"
  if [ "$PM2_STATUS" != "online" ]; then
    echo "   ❌ PM2 process not online"
    exit 1
  fi
else
  echo "   ❌ PM2 process not found"
  exit 1
fi

echo ""
echo "3. ✓ Checking frontend HTTP..."
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$FE_PORT/ | grep -q "200\|301"; then
  echo "   HTTP: 200 OK"
else
  echo "   ❌ HTTP: Failed"
  exit 1
fi

echo ""
echo "4. ✓ Checking build artifacts..."
if [ -f "$FE_PATH/.next/BUILD_ID" ]; then
  BUILD_SHA=$(cat "$FE_PATH/.last-frontend-build-sha" 2>/dev/null || echo "unknown")
  echo "   Build SHA: $BUILD_SHA"
else
  echo "   ❌ .next/BUILD_ID not found"
  exit 1
fi

echo ""
echo "✅ All health checks passed!"
```

Run it:
```bash
bash scripts/health-check.sh
```

---

## Manual Full Redeploy (nuclear option)

Use this if everything is broken and you need a clean slate:

```bash
#!/bin/bash
set -e

FE_PATH="/var/www/raghava-organics/frontend"
cd "$FE_PATH"

echo "🚀 Full frontend redeploy..."

# 1. Stop PM2
echo "Stopping PM2..."
pm2 stop raghava-organics-frontend || true

# 2. Clean everything
echo "Cleaning build artifacts..."
rm -rf .next .next.old node_modules/.cache

# 3. Sync code
echo "Syncing code..."
git fetch origin main
git checkout main
git reset --hard origin/main

# 4. Fresh install + build
echo "Installing dependencies..."
npm ci --prefer-offline --no-audit

echo "Building..."
npm run build

if [ ! -f .next/BUILD_ID ]; then
  echo "❌ Build verification failed"
  exit 1
fi

# 5. Restart
echo "Starting PM2..."
pm2 restart raghava-organics-frontend || pm2 start npm --name raghava-organics-frontend -- start -- -p 3101

# 6. Health check
echo "Health checking..."
sleep 5
curl -f http://127.0.0.1:3101/ >/dev/null || (echo "❌ Health check failed"; exit 1)

echo "✅ Full redeploy complete!"
```

---

### ❌ "Site appears broken after deployment" (CSP violations)

**Symptom:** Frontend loads but nothing works — Add to Cart buttons unresponsive, admin login stuck, payment modal doesn't open. Browser appears to hang.

**Root cause:** Content Security Policy (CSP) headers in `next.config.ts` are blocking required scripts, iframes, or API calls from third-party services (Razorpay, Turnstile, analytics).

**How to diagnose:**
```bash
# 1. SSH to VPS and check backend first (rule out backend issue)
ssh d_user@raghavaorganics.com
curl -s http://127.0.0.1:3001/api/v1/health | jq .

# 2. Open production in browser incognito mode
# - Right-click → Inspect → Console tab
# - Look for messages containing "violates the following Content Security Policy directive"
# - Note which domains are being blocked (razorpay, cloudflare, etc.)

# 3. Check Network tab for failed requests
# - Filter by "Fetch/XHR" to see API calls
# - If there are ZERO fetch calls, React didn't hydrate (CSP blocked inline scripts)
```

**Common CSP Violations:**
- `script-src` blocked → React can't hydrate → nothing works
- `frame-src` blocked → Payment/CAPTCHA iframes don't load
- `connect-src` blocked → Analytics/API calls fail silently

**Fix (in next.config.ts):**
```typescript
// Location: frontend/next.config.ts, function buildSecurityHeaders() line ~111

// Step 1: Identify which domains are being blocked (from browser console)
// Step 2: Add them to the appropriate CSP directive

const csp = [
  "default-src 'self'",
  `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://cloudflareinsights.com`,
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com",
  // ... other directives
].join("; ");
```

**Then redeploy:**
```bash
cd /var/www/raghava-organics/frontend

# Commit and push the fix
git add next.config.ts
git commit -m "fix(csp): allow [blocked-domain] for [feature]"
git push origin main

# GitHub Actions will auto-deploy, or manually redeploy:
npm run build
pm2 restart raghava-organics-frontend
sleep 5
curl http://127.0.0.1:3101/
```

**Verification:**
```bash
# Open browser DevTools on production:
# - Console: Zero CSP violation messages ✅
# - Network tab (Fetch/XHR): Service requests successful ✅
# - Click Add to Cart: Works ✅
# - Open checkout: Razorpay modal loads ✅
```

**Complete CSP Documentation:**
When adding ANY new third-party service, follow the checklist in `frontend/docs/CSP_QUICK_REFERENCE.md`. Detailed troubleshooting and service-by-service guide: `frontend/docs/CSP_AND_THIRD_PARTY_INTEGRATION_GUIDE.md`.

---

## Prevention Checklist

Before pushing to main/merging PR:

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Run `npm run lint` — zero ESLint warnings  
- [ ] Run `npm run build` locally — successful build with no warnings
- [ ] Check `.next/BUILD_ID` exists after local build
- [ ] Test on localhost:3101 — no console errors
- [ ] Test on localhost:3101 in incognito — **zero CSP violations in Console**
- [ ] Backend is running locally and health check passes
- [ ] If adding third-party integration: update CSP in `next.config.ts` BEFORE pushing
- [ ] Git status clean (no uncommitted changes)
- [ ] Commit message references the issue/feature

On VPS after GitHub Actions deployment completes:

- [ ] Backend health: `curl http://127.0.0.1:3001/api/v1/health`
- [ ] Frontend health: `curl http://127.0.0.1:3101/`
- [ ] PM2 status: `pm2 describe raghava-organics-frontend`
- [ ] Build verified: `ls .next/BUILD_ID`
- [ ] No errors in logs: `pm2 logs raghava-organics-frontend --lines 20`
- [ ] **CSP check:** Open production in browser incognito, DevTools Console — zero CSP violations
- [ ] **Feature test:** Test Add to Cart, checkout, admin login, ops login on production
