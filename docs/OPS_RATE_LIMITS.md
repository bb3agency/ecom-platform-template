# Ops Module Rate Limiting

> **Last Updated:** June 2026  
> **Scope:** Backend rate limit policies for `/api/v1/ops/*` routes  
> **Maintainer:** Operations team

## 1. Overview

All ops routes are categorized under the **"admin" tier** in the rate limit system. Rate limits are applied per-user-session and adjusted based on **load-shed mode** to prevent ops routes from overwhelming the backend during infrastructure crises.

**Configuration Source:**  
`backend/src/common/rate-limit/rate-limit-policies.ts` (lines 320–371)

---

## 2. Rate Limit Profiles

### Profile: `opsRead`
Used for information retrieval ops routes.

| Property | Value |
|----------|-------|
| Base limit | 10 req/min |
| Window | 1 minute (sliding) |
| Applied to | `GET /ops/config/overview`, `GET /ops/users`, `GET /ops/audit/logs`, etc. |
| Load-shed adjustment | **Normal**: 10/min · **Reduced**: 5/min · **Emergency**: 3/min · **Maintenance**: 1/min |

### Profile: `opsCritical`
Used for critical write operations (config save, user deactivate, load-shed change).

| Property | Value |
|----------|-------|
| Base limit | 2 req/min |
| Window | 1 minute (sliding) |
| Applied to | `POST /ops/config/save`, `POST /ops/load-shed`, `POST /ops/system/restart` |
| Load-shed adjustment | **Normal**: 2/min · **Reduced**: 1/min · **Emergency**: 0.5/min (rounds to 1) · **Maintenance**: 0/min (blocked) |

---

## 3. Load Shed Mode Adjustments

The ops routes remain functional but throttled during load-shed transitions to prevent cascading failures:

### Normal Mode (Baseline)
```
opsRead: 10 req/min
opsCritical: 2 req/min
Rationale: Full normal operation
```

### Reduced Mode (50% capacity)
```
opsRead: 10 * 0.5 = 5 req/min
opsCritical: 2 * 0.5 = 1 req/min
Rationale: Non-critical admin routes are throttled; ops can still read + perform urgent actions
```

### Emergency Mode (30% capacity)
```
opsRead: 10 * 0.3 = 3 req/min
opsCritical: 2 * 0.3 = 0.6 ≈ 1 req/min (rounded)
Rationale: Severe load, only critical ops allowed; ops must prioritize actions
```

### Maintenance Mode (10% capacity)
```
opsRead: 10 * 0.1 = 1 req/min
opsCritical: 2 * 0.1 = 0 req/min (blocked)
Rationale: Maintenance in progress; ops console allowed for monitoring, no config changes
```

---

## 4. OTP Brute-Force Protection

OTP (One-Time Password) codes are additional to rate limiting and enforce **per-challenge** constraints:

### OTP Challenge Constraints

| Constraint | Value | Storage | Check |
|---|---|---|---|
| Code format | 6 digits (100000–999999) | In-memory during generation | Service validation |
| Code hash storage | SHA256 only (never plaintext) | `OpsOtpChallenge.codeHash` (DB) | Timing-safe comparison |
| Max attempts per challenge | 3 incorrect submissions | `OpsOtpChallenge.failedAttempts` (DB) | Increment on fail, check against max |
| TTL per challenge | 10 minutes | `OpsOtpChallenge.expiresAt` (DB) | Check `now < expiresAt` on verify |
| Challenge creation rate | Covered by `opsRead` profile | N/A (API request rate limited) | Depends on load-shed mode |

### Brute-Force Attack Scenarios & Mitigations

**Scenario 1: Attacker knows valid ops user email, tries 1M codes in 10 min**
```
Rate limit: 3 max attempts per challenge
→ Attacker gets 1 challenge with 3 attempts max
→ After 3 failed: challenge.status='FAILED', further submissions rejected
→ Attacker must request NEW challenge (API-rate-limited)
→ In normal mode: can request max ~10 challenges/min
→ Total attempts in 10 min: 10 challenges × 3 attempts = 30 attempts (out of 1M)
→ Success probability: 30/1M = 0.003% (brute-force not viable)
```

**Scenario 2: Attacker has ops_session cookie, tries to change config without OTP**
```
No mitigation needed; OTP enforcement at application level
→ Missing/invalid challengeId or otpCode → 400 INVALID_REQUEST
→ No rate limit applied to failed OTP submits per se (but challenge creation is rate-limited)
```

**Scenario 3: Attacker requests unlimited OTP challenges to enumerate email**
```
Rate limit: opsRead profile limits OTP requests to ~10/min (normal mode)
→ After 10th request in same minute: 429 TOO_MANY_REQUESTS
→ Further requests blocked
→ User must wait until next 1-minute window
→ No email enumeration leak
```

**Scenario 4: Botnet submits OTP codes at 1000 req/sec**
```
Attack blocked at three layers:
1. Rate limit guard: 429 responses, connection throttle
2. OTP constraint: 3 attempts per challenge max
3. Challenge state: once FAILED, cannot be reused (attacker must create new challenge, re-triggering rate limit)
```

---

## 5. Implementation Details

### Rate Limit Key Generation

**Where:**  
`backend/src/common/rate-limit/rate-limit-guard.ts` (lines 180–220)

**Logic:**
```typescript
function generateRateLimitKey(request: FastifyRequest): string {
  // For ops routes: use opsUserId from request.opsUser
  // For public routes (login): use IP address
  
  if (request.opsUser) {
    return `rate-limit:ops:${request.opsUser.id}`;
  }
  
  if (request.path.includes('/ops/auth/login')) {
    return `rate-limit:ops-login:${request.ip}`;
  }
  
  return `rate-limit:unknown:${request.ip}`;
}
```

**Result:**
- Each authenticated ops user has independent rate limit bucket
- Shared bucket for login attempts (per IP)
- No cross-user interference

### Redis Storage Format

**Key:** `rate-limit:ops:ops_xyz`  
**Value:**
```json
{
  "count": 5,
  "resetAt": 1718396700000
}
```

**Behavior:**
- Increment on each request
- TTL = 60 seconds (sliding window)
- When TTL expires, key auto-deletes
- Next request in new window resets count=1

### Guard Implementation

**File:** `backend/src/common/rate-limit/rate-limit-guard.ts`

```typescript
export async function rateLimitGuard(request: FastifyRequest): Promise<void> {
  const profile = resolveRateLimitProfile(request.path, request.method);
  const key = generateRateLimitKey(request);
  const loadShedMode = getLoadShedMode(); // 'normal', 'reduced', etc.
  
  const limit = applyLoadShedFactor(profile.baseLimit, loadShedMode);
  const current = await redis.incr(key);
  
  if (current === 1) {
    // First request in window, set TTL
    await redis.expire(key, 60);
  }
  
  if (current > limit) {
    throw new AppError(
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
      `Too many requests: ${current}/${limit} in current minute`,
      429
    );
  }
}
```

### Frontend Response Handling

**On 429 TOO_MANY_REQUESTS:**

```typescript
// frontend/hooks/use-ops-guard.ts
if (error.status === 429) {
  // Rate limit error from backend
  showNotification({
    type: 'warning',
    title: 'Rate Limit Exceeded',
    message: 'You\'re making changes too quickly. Please wait a moment.',
    duration: 5000
  });
  
  // Don't retry immediately; wait until next window (60s)
  const retryAfter = parseInt(error.headers['retry-after'] || '60', 10);
  setTimeout(() => {
    // User can retry after retryAfter seconds
  }, retryAfter * 1000);
}
```

---

## 6. Testing Rate Limits

### Unit Test: Rate Limit Enforcement

**File:** `backend/src/modules/ops/ops.rate-limit.test.ts` (NEW)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rateLimitGuard } from '@common/rate-limit/rate-limit-guard';

describe('Ops rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear Redis test data
    redis.flushdb();
  });

  it('enforces opsRead limit in normal mode', async () => {
    mockLoadShedMode('normal');
    const userId = 'ops_test_1';
    
    // Make 10 requests (within limit)
    for (let i = 0; i < 10; i++) {
      const request = createMockRequest({
        opsUser: { id: userId },
        path: '/api/v1/ops/config/overview'
      });
      
      expect(async () => {
        await rateLimitGuard(request);
      }).not.toThrow();
    }
    
    // 11th request (exceeds limit)
    const request11 = createMockRequest({
      opsUser: { id: userId },
      path: '/api/v1/ops/config/overview'
    });
    
    await expect(rateLimitGuard(request11)).rejects.toThrow(
      /RATE_LIMIT_EXCEEDED|Too many requests/
    );
  });

  it('applies reduced limits during emergency mode', async () => {
    mockLoadShedMode('emergency');
    const userId = 'ops_test_2';
    
    // In emergency: opsRead = 10 * 0.3 = 3 req/min
    for (let i = 0; i < 3; i++) {
      const request = createMockRequest({
        opsUser: { id: userId },
        path: '/api/v1/ops/users'
      });
      await expect(rateLimitGuard(request)).resolves.not.toThrow();
    }
    
    // 4th request (exceeds emergency limit)
    const request4 = createMockRequest({
      opsUser: { id: userId },
      path: '/api/v1/ops/users'
    });
    await expect(rateLimitGuard(request4)).rejects.toThrow(/RATE_LIMIT_EXCEEDED/);
  });

  it('restricts critical operations during maintenance', async () => {
    mockLoadShedMode('maintenance');
    const userId = 'ops_test_3';
    
    // In maintenance: opsCritical = 2 * 0.1 = 0 (blocked)
    const request = createMockRequest({
      opsUser: { id: userId },
      path: '/api/v1/ops/config/save',
      method: 'POST'
    });
    
    await expect(rateLimitGuard(request)).rejects.toThrow(/RATE_LIMIT_EXCEEDED/);
  });

  it('respects per-user independent limits', async () => {
    mockLoadShedMode('normal');
    
    // User A: 10 requests (at limit)
    for (let i = 0; i < 10; i++) {
      const request = createMockRequest({
        opsUser: { id: 'ops_user_a' },
        path: '/api/v1/ops/config/overview'
      });
      await expect(rateLimitGuard(request)).resolves.not.toThrow();
    }
    
    // User A: 11th request (exceeds, should fail)
    const reqA11 = createMockRequest({
      opsUser: { id: 'ops_user_a' },
      path: '/api/v1/ops/config/overview'
    });
    await expect(rateLimitGuard(reqA11)).rejects.toThrow(/RATE_LIMIT_EXCEEDED/);
    
    // User B: Can still make requests (independent bucket)
    const reqB1 = createMockRequest({
      opsUser: { id: 'ops_user_b' },
      path: '/api/v1/ops/config/overview'
    });
    await expect(rateLimitGuard(reqB1)).resolves.not.toThrow();
  });
});
```

### E2E Test: OTP Brute-Force Protection

**File:** `backend/src/modules/ops/ops.e2e.test.ts` (see Phase 2)

```typescript
it('locks OTP challenge after 3 failed attempts', async () => {
  const opsService = new OpsService(prisma, redis, logger);
  const user = await createTestOpsUser(prisma);
  
  // Request OTP for critical action
  const challenge = await opsService.requestEmailOtp({
    opsUserId: user.id,
    action: 'config-save'
  });
  
  // Submit wrong code 3 times
  for (let i = 0; i < 3; i++) {
    await expect(
      opsService.verifyEmailOtp({
        opsUserId: user.id,
        challengeId: challenge.challengeId,
        code: '000000'
      })
    ).rejects.toThrow(/INVALID_CREDENTIALS|UNAUTHORISED/);
  }
  
  // Verify challenge status is FAILED
  const lockedChallenge = await prisma.opsOtpChallenge.findUnique({
    where: { id: challenge.challengeId }
  });
  expect(lockedChallenge?.status).toBe('FAILED');
  expect(lockedChallenge?.failedAttempts).toBe(3);
  
  // 4th attempt should fail with "not pending" (not rate limit)
  await expect(
    opsService.verifyEmailOtp({
      opsUserId: user.id,
      challengeId: challenge.challengeId,
      code: '000000'
    })
  ).rejects.toThrow(/not pending|INVALID_STATE/);
  
  // Request new OTP to try again (tests rate limit)
  const challenge2 = await opsService.requestEmailOtp({
    opsUserId: user.id,
    action: 'config-save'
  });
  expect(challenge2.challengeId).not.toBe(challenge.challengeId);
});
```

---

## 7. Monitoring & Alerting

### Metrics to Track

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Avg ops request latency | >1s | Investigate backend load |
| 429 error rate (ops routes) | >10% of requests | Check for brute-force attack |
| OTP failed attempts | >50 in 5 min | Brute-force alert |
| Load-shed mode active | Any duration >30 min | Escalate (should be temporary) |
| Audit chain lock contention | >1% of ops writes | Investigate concurrent ops traffic |

### Alerting (Future: Integrate with monitoring)

```yaml
# Prometheus alert rules (future implementation)
- alert: OpsBruteForceSuspected
  expr: |
    rate(ops_otp_failed_attempts_total[5m]) > 10
  for: 1m
  annotations:
    summary: "OTP brute-force attack suspected"
    
- alert: LoadShedProlonged
  expr: |
    load_shed_mode != "normal" and 
    load_shed_mode_duration_seconds > 1800
  for: 5m
  annotations:
    summary: "Load-shed mode active for >30 min"
```

---

## 8. Rate Limit Policy Audit

**When:** Quarterly security review + on any load-shed mode changes

**Checklist:**

- [ ] opsRead profile limit (10 req/min base) still appropriate?
- [ ] opsCritical profile limit (2 req/min base) still appropriate?
- [ ] Load-shed factors (0.5/0.3/0.1) still reflect reality?
- [ ] OTP max attempts (3) still acceptable UX?
- [ ] OTP TTL (10 min) still realistic for email delivery?
- [ ] No new critical ops routes without rate limit assignment?
- [ ] Redis monitoring shows healthy rate limit key eviction?

---

## References

- **Guard Implementation**: `backend/src/common/rate-limit/rate-limit-guard.ts`
- **Profile Definitions**: `backend/src/common/rate-limit/rate-limit-policies.ts` (lines 320–371)
- **OTP Logic**: `backend/src/modules/ops/ops.service.ts` (lines 400–650)
- **Load-Shed Modes**: `backend/src/common/reliability/load-shed.guard.ts`
- **Tests**: `backend/src/modules/ops/ops.rate-limit.test.ts` (NEW)

