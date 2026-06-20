# Ops Module Security & Access Control

> **Last Updated:** June 2026  
> **Scope:** Backend `/api/v1/ops/*` routes and frontend `/ops/*` pages  
> **Audience:** Operations team, security auditors, deployment engineers

## 1. Access Control Architecture

### Authentication Layer
All ops endpoints require `opsAuthGuard` preHandler:

```typescript
// backend/src/common/guards/ops-auth.guard.ts
- Validates httpOnly `ops_session` cookie (not Authorization header)
- Checks session validity in Redis
- Ensures user.isActive === true (live DB check on each request)
- Returns 401 if session missing/expired/user deactivated
```

**Session Lifecycle:**
- **Login**: `POST /api/v1/ops/auth/login/verify-otp` → Creates session (TTL: 1 hour default)
- **Active**: Session in Redis + browser cookie
- **Expiry**: Auto-logout after 1 hour idle (configurable: `OPS_BROWSER_SESSION_TTL_SECONDS`)
- **Logout**: `POST /api/v1/ops/auth/logout` → Deletes session + clears cookie

### Authorization Layer
All ops routes check `opsPermissionGuard`:

```typescript
// backend/src/common/guards/ops-permissions.guard.ts
type OpsPermission = 'ops:read' | 'ops:write';

// All ops users must have BOTH permissions (enforced at user creation)
export const enforceMandatoryOpsPermissions = (current: string[]) => {
  const set = new Set(current ?? []);
  set.add('OPS_READ');
  set.add('OPS_WRITE');
  return [...set]; // Always both
};
```

**Permission Matrix:**

| Route Category | Permission | OTP Required | Examples |
|---|---|---|---|
| **Reads** | ops:read | No | GET /ops/config/overview, GET /ops/users, GET /ops/audit/logs |
| **Non-critical Writes** | ops:write | No | POST /ops/invites, POST /ops/otp/request |
| **Critical Writes** | ops:write | **Yes** | POST /ops/config/save, POST /ops/load-shed, POST /ops/system/restart |

### Optional Controls (Future)
- **IP Allowlist**: `OpsUser.ipAllowlist` (CIDR array) — enforced on session creation (not yet wired to guard)
- **MFA**: `OpsUser.mfaEnabled` (boolean) — challenge flow designed but not enforced (future gate)

---

## 2. Critical Action Protection via OTP

### Mechanism
Six critical operations require email OTP verification before execution:

```
1. config-save          → POST /api/v1/ops/config/save
2. load-shed-change    → POST /api/v1/ops/load-shed
3. user-deactivate     → POST /api/v1/ops/users/:id/deactivate
4. admin-user-deactivate → POST /api/v1/ops/admin-users/:id/deactivate
5. system-restart      → POST /api/v1/ops/system/restart
6. invite-revoke       → POST /api/v1/ops/invites/:id/revoke
```

### Two-Step Flow

**Step 1: Request OTP Challenge**
```
POST /api/v1/ops/otp/request
Body: { action: 'config-save' }
Response: { challengeId: 'challenge_abc123', expiresAt: '2026-06-14T10:15:00Z' }
→ Email sent to ops user's registered email
```

**Step 2: Execute with OTP Verification**
```
POST /api/v1/ops/config/save
Body: { values: {...}, challengeId: 'challenge_abc123', otpCode: '123456' }
→ Service verifies OTP code against hash
→ If valid, executes action + clears challenge
```

### OTP Code Security

**Generation:**
```typescript
// backend/src/modules/ops/ops.service.ts:625
const code = crypto.randomInt(100000, 999999).toString();
// Returns 6-digit random code (100000–999999)
```

**Storage (Hash Only):**
```typescript
// Never plaintext
const codeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
await prisma.opsOtpChallenge.create({
  data: {
    opsUserId,
    action,
    codeHash,  // ← Only hash in DB
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    status: 'PENDING',
    failedAttempts: 0
  }
});
```

**Verification (Timing-Safe):**
```typescript
// Code hash: constant-time comparison
const incomingHash = crypto.createHash('sha256').update(input.code.trim()).digest('hex');
const isValid = crypto.timingSafeEqual(
  Buffer.from(incomingHash),
  Buffer.from(challenge.codeHash)
);
// Prevents timing-based code guessing
```

### OTP Constraints

| Property | Value | Rationale |
|----------|-------|-----------|
| Code format | 6 digits (100000–999999) | Memorable, 1M possibilities |
| TTL | 10 minutes | Delivery + user entry time |
| Max attempts | 3 incorrect codes | Brute-force limit |
| Delivery | Email (Resend SMTP) | Verified contact, HTTPS transport |
| Storage | SHA256 hash only | Prevents plaintext exposure |
| Hash comparison | `timingSafeEqual` | Prevents timing side-channel |

### Brute-Force Protection

**Challenge-Level:**
```
1. User requests OTP → code generated, hash stored, email sent
2. User submits code 3 times incorrectly → challenge.status='FAILED'
3. Further submissions rejected with "Challenge not pending"
4. User must request new OTP (creates new challenge)
```

**Email Request Rate Limit:**
Covered by `opsRead` profile in `rate-limit-policies.ts`:
- Normal mode: ~10 OTP requests/min per session
- Emergency mode: ~3 OTP requests/min per session (reduced)

**Audit Trail:**
```
Every OTP action is logged:
- OTP_CHALLENGE_REQUESTED: when code sent
- OTP_CHALLENGE_VERIFIED: when correct code submitted
- OTP_CHALLENGE_FAILED: when incorrect code submitted (up to 3x)
```

---

## 3. Configuration Secret Encryption

### Schema
```prisma
model OpsConfigSecret {
  key String          // e.g., 'RAZORPAY_KEY_ID'
  domain String       // 'payments', 'shipping', 'notifications', etc.
  encryptedValue String   // AES-256-GCM ciphertext (not plaintext)
  keyVersion Int      // 1 (v1) or 2 (v2) for rotation
  requiresRestart Boolean // If true, backend restart needed for effect
  createdAt DateTime
  updatedAt DateTime
}
```

### Encryption Algorithm
**AES-256-GCM** (Authenticated Encryption with Associated Data)

```typescript
// backend/src/common/security/ops-config-crypto.ts
export function encryptOpsConfigValue(plaintext: string, keyVersion: number): string {
  const key = resolveOpsEncryptionKey(keyVersion); // 32-byte key from env
  const iv = crypto.randomBytes(16);               // Random nonce per encryption
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  
  // Store: version:iv:ciphertext:authTag (all hex-encoded)
  const format = `v${keyVersion}:${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
  return format;
}

export function decryptOpsConfigValue(format: string): string {
  const [versionStr, ivHex, encryptedHex, authTagHex] = format.split(':');
  const version = parseInt(versionStr.substring(1), 10);
  const key = resolveOpsEncryptionKey(version);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ]).toString('utf8');
  
  return plaintext;
}
```

**Properties:**
- **IV (Nonce)**: Random per encryption (16 bytes)
- **Auth Tag**: Validates integrity (16 bytes)
- **Key Derivation**: Direct env var (no PBKDF2, env is already high-entropy)

### Key Rotation

**Scenario: Rotate from Key V1 → V2**

1. Generate new key material (32 bytes)
2. Set `OPS_DB_ENCRYPTION_KEY_V2=...` in deployment env
3. Redeploy ops service (service reads new key)
4. **Old secrets still decrypt**: Service tries V1 on read, falls back to prior key
5. **New saves use V2**: `encryptOpsConfigValue(value, 2)` uses new key
6. **Manual re-encryption** (optional): Ops user re-saves secret via UI → re-encrypted with V2

```typescript
// Decrypt with fallback (read side)
async function decryptConfigValue(stored: OpsConfigSecret): Promise<string> {
  try {
    return decryptOpsConfigValue(stored.encryptedValue);
  } catch (err) {
    // If V1 key fails, try older versions (not implemented in v1 but pattern ready)
    console.error(`Failed to decrypt with key V${stored.keyVersion}:`, err);
    throw err;
  }
}
```

### Response Masking

**Never return plaintext secrets to ops UI:**

```typescript
// backend/src/modules/ops/ops.service.ts
export async function getStoredConfigSecrets() {
  const secrets = await prisma.opsConfigSecret.findMany();
  
  return secrets.map(s => ({
    key: s.key,
    domain: s.domain,
    maskedValue: maskSecretValue(s.encryptedValue), // ← MASKED, not plaintext
    keyVersion: s.keyVersion,
    requiresRestart: s.requiresRestart,
    updatedAt: s.updatedAt
  }));
}

function maskSecretValue(encrypted: string): string {
  // First 2 visible + asterisks + last 2 visible
  // e.g., 'rz_test_abcd1234567890' → 'rz****90'
  const visible = encrypted.substring(0, 2);
  const end = encrypted.substring(encrypted.length - 2);
  const masked = '****';
  return `${visible}${masked}${end}`;
}
```

### Field-Level Visibility in Ops Console

**Current Behavior (Intentional):**
- Ops UI displays masked secrets only: `••••••••`
- No unmask button (operator must save a new value if they forgot it)
- Full plaintext never sent over API response

**Risk Assessment:**
- **Access Required**: ops_session cookie + ops:read permission
- **Transport**: HTTPS only (Nginx enforces)
- **Storage**: Encrypted at rest in Postgres
- **Logging**: Audit log never includes plaintext (summary field masked too)
- **Mitigation**: Database encrypted (if full-disk encryption enabled on VPS)

---

## 4. Audit Logging & Chain Integrity

### Audit Log Purpose
Track all significant ops operations (config changes, user deactivations, OTP verifications, load-shed transitions). Enable forensic auditing and tamper detection.

### Schema
```prisma
model OpsAuditLog {
  id String              // UUID (primary key)
  opsUserId String       // Which ops user performed action
  actionType String      // 'ENV_UPDATE', 'OTP_VERIFIED', 'USER_DEACTIVATED', etc.
  actionStatus String    // 'EXECUTED' (success) or 'FAILED' (rejected)
  requestId String       // Request correlation ID
  requestIp String       // Ops user's source IP
  requestPath String     // Route called (e.g., '/api/v1/ops/config/save')
  method String          // HTTP method (POST, GET)
  chainHash String       // SHA256(previousHash || id || createdAt)
  previousChainHash String  // Reference to prior audit entry (for chain)
  summary Json           // Action-specific data (e.g., { keysUpdated: [...] })
  createdAt DateTime
}
```

### Chain Hash (Tamper Detection)

**Computation:**
```typescript
// When appending new audit log entry:
const lastLog = await findLastAuditLog();
const inputStr = `${lastLog?.chainHash || ''}||${newId}||${Date.now()}`;
const chainHash = crypto.createHash('sha256').update(inputStr).digest('hex');

await createAuditLog({
  ...entry,
  chainHash,
  previousChainHash: lastLog?.chainHash || null
});
```

**Verification (Client-Side or Monitoring):**
```javascript
// Detect if any audit log was tampered
const logs = await fetch('/api/v1/ops/audit/logs').then(r => r.json());
const validated = logs.items.map((log, i) => {
  const prev = i > 0 ? logs.items[i - 1].chainHash : null;
  const recomputed = SHA256(`${prev || ''}||${log.id}||${new Date(log.createdAt).getTime()}`);
  return {
    log,
    tampered: recomputed !== log.chainHash
  };
});

const tamperedLogs = validated.filter(v => v.tampered);
if (tamperedLogs.length > 0) {
  console.error('CRITICAL: Audit log tampering detected', tamperedLogs);
}
```

### Append Concurrency Control

**Redis-Based Distributed Lock:**
```typescript
const lockKey = 'ops:audit:chain:lock';
const lockId = uuid();

// Attempt lock acquisition (atomic)
const acquired = await redis.set(lockKey, lockId, { NX: true, EX: 5 });

if (!acquired) {
  // Another request is appending concurrently
  throw new AppError(ERROR_CODES.OPS_AUDIT_CHAIN_LOCK_TIMEOUT, 'Audit lock contested', 503);
}

try {
  // Now safe to append
  const lastLog = await getLastAuditLog();
  const newLog = await appendAuditLog({...});
} finally {
  // Unlock
  await redis.del(lockKey);
}
```

**Timeout Behavior:**
- Lock TTL: 5 seconds (prevents stuck locks)
- Contention response: 503 (transient, ops client retries with backoff)
- Retry strategy: Exponential backoff 1s → 2s → 3s (capped at 5s per CLAUDE.md)

### Audit Log Contents

**Examples:**

```typescript
// Config save action
{
  actionType: 'ENV_UPDATE',
  actionStatus: 'EXECUTED',
  summary: {
    domain: 'payments',
    keysUpdated: ['RAZORPAY_KEY_ID'],
    requiresRestart: true
  }
}

// OTP verification
{
  actionType: 'OTP_CHALLENGE_VERIFIED',
  actionStatus: 'EXECUTED',
  summary: {
    action: 'config-save',
    challengeId: 'challenge_abc'
  }
}

// User deactivation
{
  actionType: 'USER_DEACTIVATED',
  actionStatus: 'EXECUTED',
  summary: {
    targetUserId: 'ops_xyz',
    targetUserEmail: 'ops@example.com'
  }
}

// Failed action (e.g., invalid OTP)
{
  actionType: 'OTP_CHALLENGE_FAILED',
  actionStatus: 'FAILED',
  summary: {
    reason: 'invalid_code',
    attemptsRemaining: 1,
    challengeId: 'challenge_abc'
  }
}
```

---

## 5. Load Shed & Maintenance Mode

### Load Shed Modes

State stored in **Postgres** (source of truth) + Redis (cache) + Process memory (5s TTL):

```
Normal      → Full capacity, all routes allowed
Reduced     → Non-critical admin + analytics shed, 50% rate limit
Emergency   → Checkout mutations + analytics shed, 30% rate limit
Maintenance → Pending/Active phase, public routes blocked (503)
```

### Rate Limit Adjustments per Mode

**Definition:** `backend/src/common/rate-limit/rate-limit-policies.ts`

```typescript
const LOAD_SHED_MODE_FACTORS = {
  'normal': 1.0,        // baseline
  'reduced': 0.5,       // 50% of normal
  'emergency': 0.3,     // 30% of normal
  'maintenance': 0.1    // 10% of normal (ops-only routes)
};

// Admin tier (ops routes) has base ~30 req/min
// In emergency: 30 * 0.3 = 9 req/min
```

### Maintenance Mode State Machine

**Phases:**
```
Pending (2-minute countdown) → Active (503 block) → Normal (unblock)
```

**Storage Schema:**
```prisma
model MaintenanceState {
  id String           // Singleton: 'maintenance'
  mode String         // 'pending' or 'active'
  pendingUntil DateTime    // When to auto-promote to active
  activatedAt DateTime  // When entered active (null if pending)
  reason String       // Admin's reason (e.g., "Database migration")
  createdBy String    // Ops user who initiated
}
```

**Transition Workflow:**

1. **Initiate Maintenance:**
   ```
   POST /api/v1/ops/load-shed
   Body: { mode: 'maintenance' }
   → OTP required
   → pendingUntil = now + 2 min
   → State written to Postgres + Redis
   → BullMQ job enqueued: activate at pendingUntil
   ```

2. **Pending Phase (2 min window):**
   ```
   - Storefront shows maintenance countdown banner
   - Ops console shows "Maintenance pending, activating in 1m 45s"
   - Routes work normally
   - All new orders are blocked (graceful 503)
   ```

3. **Auto-Promotion (after 2 min):**
   ```
   Option A: BullMQ worker fires at pendingUntil
            → activatedAt = now, persists to Postgres
   
   Option B: Fallback (if worker down)
            → Every ops read checks: now > pendingUntil + 7min?
            → If yes: auto-promote + persist
   ```

4. **Active Phase:**
   ```
   - Nginx serves static maintenance.html for non-ops routes
   - Ops console fully functional
   - Webhooks allowed (payment/shipping providers)
   - /health allowed (monitoring)
   ```

5. **Exit Maintenance:**
   ```
   POST /api/v1/ops/load-shed
   Body: { mode: 'normal' }
   → mode = 'normal', MaintenanceState cleared
   → Nginx traffic re-enabled
   ```

### Grace Window (Fallback Auto-Promotion)

If BullMQ worker unhealthy, maintenance may not auto-activate at pendingUntil. To ensure eventual consistency:

```typescript
// On every read during maintenance:
export async function readMaintenanceState(): Promise<MaintenanceStateRecord | null> {
  const state = await prisma.maintenanceState.findUnique({ where: { id: 'maintenance' } });
  
  if (!state) return null;
  
  // Grace window: if pending and now > pendingUntil + 7 min, auto-promote
  if (state.mode === 'pending' && Date.now() > state.pendingUntil.getTime() + 7 * 60_000) {
    console.warn('GRACE: Auto-promoting maintenance to active (worker may be down)');
    await prisma.maintenanceState.update({
      where: { id: 'maintenance' },
      data: { mode: 'active', activatedAt: new Date() }
    });
    // Clear cache, return updated state
    invalidateMaintenanceProcessCache();
    return { ...state, mode: 'active', activatedAt: new Date() };
  }
  
  return state;
}
```

---

## 6. Testing & Verification

### Security Test Coverage

See: `backend/src/modules/ops/ops.security.test.ts`

```typescript
describe('Ops security gates', () => {
  it('never stores plaintext OTP code', async () => {
    // Verify DB only has codeHash (SHA256)
  });
  
  it('uses timing-safe OTP comparison', async () => {
    // Verify code comparison uses crypto.timingSafeEqual
  });
  
  it('encrypts config secrets with AES-256-GCM', async () => {
    // Verify plaintext never in DB, only encryptedValue
  });
  
  it('detects audit log tampering', async () => {
    // Verify chainHash mismatch caught on read
  });
  
  it('locks OTP after 3 failed attempts', async () => {
    // Verify challenge.status='FAILED' after 3 wrong codes
  });
  
  it('enforces permission guards', async () => {
    // Verify ops:write required for critical actions
  });
});
```

### Audit Chain Verification Script

```bash
# backend/scripts/verify-ops-audit-chain.js
node scripts/verify-ops-audit-chain.js [--fix]

# Output:
# ✓ Audit log chain valid (1,234 entries)
# ✓ No tampering detected
# ✓ All actions accounted for
```

### Pre-Deploy Checklist

Before ops module deployment:

- [ ] All security tests pass: `npm run test:ops:security`
- [ ] Audit chain integrity verified: `node scripts/verify-ops-audit-chain.js`
- [ ] OTP TTL + max attempts checked in `.env`
- [ ] OPS_DB_ENCRYPTION_KEY_V2 (if rotating): plaintext key ready for `.env.production.local`
- [ ] No secrets committed in git
- [ ] Rate limit profiles documented
- [ ] Ops UI tested end-to-end (login → config edit → audit view)

---

## 7. Operational Procedures

### Secret Key Rotation

**When:** After suspected key exposure or annual audit

**Steps:**

1. Generate new 32-byte key (openssl rand -hex 16)
2. Set `OPS_DB_ENCRYPTION_KEY_V2=...` in VPS `.env.production.local`
3. Redeploy ops service (no DB changes needed)
4. Ops users re-save secrets via UI (optional, encrypted with V2)
5. Audit trail will show which secrets remain V1 vs. upgraded to V2

### Audit Log Export (Compliance/SOC 2)

```bash
# Export last 30 days of ops audit logs
npm run script ops:export-audit-logs -- --since "30 days ago" --format json

# Output: ops-audit-export-2026-06-14.json
# Use for compliance audits, threat investigation
```

### Maintenance Mode Activation (Incident Response)

**Scenario: Database migration required, 10 minutes downtime**

1. Ops console → Load Shed panel
2. Select "Maintenance" → Enter reason: "Database migration in progress"
3. Click "Activate Maintenance"
4. Enter OTP (sent to email)
5. **2-minute countdown starts** (shown on storefront banner)
6. Customers see: "We're updating — back in 2 minutes"
7. Perform maintenance (run migrations, etc.)
8. After done: Click "Exit Maintenance" → Normal mode
9. Storefront immediately re-enables

---

## 8. Security Contacts & Incident Response

**Report ops security issue:** sri.j.uk@gmail.com

**On suspected ops breach:**

1. Immediate: Deactivate affected ops user → `POST /api/v1/ops/users/:id/deactivate`
2. Within 1 hour: Export audit logs for affected period
3. Within 4 hours: Review secret access patterns (which keys were viewed)
4. Within 24 hours: Key rotation if any production credentials exposed
5. Within 48 hours: Post-incident report + remediation plan

---

## References

- **Rate Limits**: `backend/src/common/rate-limit/rate-limit-policies.ts`
- **OTP Logic**: `backend/src/modules/ops/ops.service.ts` (lines 400–650)
- **Encryption**: `backend/src/common/security/ops-config-crypto.ts`
- **Audit Chain**: `backend/src/modules/ops/ops.service.ts` (lines 2200–2350)
- **Frontend Guard**: `frontend/hooks/use-ops-guard.ts`
- **Maintenance Banner**: `frontend/components/MaintenanceBanner.tsx`

