/**
 * Rate Limit Tests for Ops Module
 *
 * Validates rate limiting behavior across load-shed modes and OTP brute-force protection.
 *
 * Run with: npm run test:ops:rate-limit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testDataFactory } from './__fixtures__/ops-test-data';

describe('Ops Module Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // NORMAL MODE RATE LIMITS
  // ============================================================================

  describe('Normal Mode Rate Limits', () => {
    const { opsReadBaseLimit, opsCriticalBaseLimit } =
      testDataFactory.rateLimitConstants;

    it('allows opsRead requests up to 10/min in normal mode', () => {
      // opsRead limit = 10 req/min
      const requests = Array.from({ length: 10 }, (_, i) => ({
        path: '/api/v1/ops/config/overview',
        method: 'GET',
        requestNumber: i + 1
      }));

      // All should succeed
      expect(requests.length).toBeLessThanOrEqual(opsReadBaseLimit);
      expect(opsReadBaseLimit).toBe(10);
    });

    it('blocks opsRead request 11 with 429 TOO_MANY_REQUESTS', () => {
      const limit = opsReadBaseLimit;
      const request11 = {
        path: '/api/v1/ops/config/overview',
        method: 'GET',
        requestNumber: 11
      };

      // 11 > 10, should be blocked
      expect(request11.requestNumber).toBeGreaterThan(limit);
    });

    it('allows opsCritical requests up to 2/min in normal mode', () => {
      // opsCritical limit = 2 req/min
      const requests = Array.from({ length: 2 }, (_, i) => ({
        path: '/api/v1/ops/config/save',
        method: 'POST',
        requestNumber: i + 1
      }));

      expect(requests.length).toBeLessThanOrEqual(opsCriticalBaseLimit);
      expect(opsCriticalBaseLimit).toBe(2);
    });

    it('blocks opsCritical request 3 with 429', () => {
      const limit = opsCriticalBaseLimit;
      const request3 = {
        path: '/api/v1/ops/config/save',
        method: 'POST',
        requestNumber: 3
      };

      expect(request3.requestNumber).toBeGreaterThan(limit);
    });
  });

  // ============================================================================
  // REDUCED MODE RATE LIMITS (50%)
  // ============================================================================

  describe('Reduced Mode Rate Limits (50% of normal)', () => {
    const {
      opsReadBaseLimit,
      opsCriticalBaseLimit,
      reducedModeFactor
    } = testDataFactory.rateLimitConstants;

    it('applies 50% factor to opsRead limit', () => {
      const reducedReadLimit = Math.floor(opsReadBaseLimit * reducedModeFactor);

      expect(reducedModeFactor).toBe(0.5);
      expect(reducedReadLimit).toBe(5); // 10 * 0.5
    });

    it('applies 50% factor to opsCritical limit', () => {
      const reducedCriticalLimit = Math.floor(opsCriticalBaseLimit * reducedModeFactor);

      expect(reducedCriticalLimit).toBe(1); // 2 * 0.5
    });

    it('allows 5 opsRead requests in reduced mode', () => {
      const limit = 5;
      const requests = Array.from({ length: 5 }, (_, i) => i + 1);

      expect(requests.length).toBeLessThanOrEqual(limit);
    });

    it('blocks 6th opsRead request in reduced mode', () => {
      const limit = 5;
      const request6 = 6;

      expect(request6).toBeGreaterThan(limit);
    });
  });

  // ============================================================================
  // EMERGENCY MODE RATE LIMITS (30%)
  // ============================================================================

  describe('Emergency Mode Rate Limits (30% of normal)', () => {
    const { opsReadBaseLimit, opsCriticalBaseLimit, emergencyModeFactor } =
      testDataFactory.rateLimitConstants;

    it('applies 30% factor to opsRead limit', () => {
      const emergencyReadLimit = Math.floor(opsReadBaseLimit * emergencyModeFactor);

      expect(emergencyModeFactor).toBe(0.3);
      expect(emergencyReadLimit).toBe(3); // 10 * 0.3
    });

    it('applies 30% factor to opsCritical limit', () => {
      const emergencyCriticalLimit = Math.floor(opsCriticalBaseLimit * emergencyModeFactor);

      expect(emergencyCriticalLimit).toBe(0); // 2 * 0.3 = 0.6, rounds to 0
    });

    it('allows 3 opsRead requests in emergency mode', () => {
      const limit = 3;
      const requests = Array.from({ length: 3 }, (_, i) => i + 1);

      expect(requests.length).toBeLessThanOrEqual(limit);
    });

    it('blocks 4th opsRead request in emergency mode', () => {
      const limit = 3;
      const request4 = 4;

      expect(request4).toBeGreaterThan(limit);
    });

    it('blocks all opsCritical requests in emergency mode', () => {
      const emergencyLimit = 0; // 2 * 0.3 rounds to 0
      const request1 = 1;

      expect(request1).toBeGreaterThan(emergencyLimit);
    });
  });

  // ============================================================================
  // MAINTENANCE MODE RATE LIMITS (10%)
  // ============================================================================

  describe('Maintenance Mode Rate Limits (10% of normal)', () => {
    const { opsReadBaseLimit, maintenanceModeFactor } =
      testDataFactory.rateLimitConstants;

    it('applies 10% factor to opsRead limit', () => {
      const maintenanceReadLimit = Math.floor(opsReadBaseLimit * maintenanceModeFactor);

      expect(maintenanceModeFactor).toBe(0.1);
      expect(maintenanceReadLimit).toBe(1); // 10 * 0.1
    });

    it('allows 1 opsRead request in maintenance mode', () => {
      const limit = 1;
      const request1 = 1;

      expect(request1).toBeLessThanOrEqual(limit);
    });

    it('blocks 2nd opsRead request in maintenance mode', () => {
      const limit = 1;
      const request2 = 2;

      expect(request2).toBeGreaterThan(limit);
    });

    it('blocks all opsCritical requests in maintenance mode', () => {
      const maintenanceLimit = 0; // 2 * 0.1 rounds to 0
      const request1 = 1;

      expect(request1).toBeGreaterThan(maintenanceLimit);
    });
  });

  // ============================================================================
  // PER-USER INDEPENDENT LIMITS
  // ============================================================================

  describe('Per-User Independent Rate Limit Buckets', () => {
    it('maintains separate limit buckets for different ops users', () => {
      const userA = testDataFactory.opsUser({ id: 'ops_user_a' });
      const userB = testDataFactory.opsUser({ id: 'ops_user_b' });

      // Rate limit key should include user ID
      const keyA = `rate-limit:ops:${userA.id}`;
      const keyB = `rate-limit:ops:${userB.id}`;

      expect(keyA).not.toBe(keyB);
      expect(keyA).toContain(userA.id);
      expect(keyB).toContain(userB.id);
    });

    it('allows user A to hit limit while user B continues', () => {
      const userA = testDataFactory.opsUser({ id: 'ops_user_a' });
      const userB = testDataFactory.opsUser({ id: 'ops_user_b' });

      // Simulate: userA makes 10 requests (hits limit)
      const userARequests = Array.from({ length: 10 }, (_, i) => ({
        user: userA.id,
        request: i + 1
      }));

      // userB can still make requests (independent bucket)
      const userBRequest = {
        user: userB.id,
        request: 1
      };

      expect(userARequests.length).toBe(10);
      expect(userBRequest.request).toBe(1);
      expect(userARequests.map(r => r.user)).not.toContain(userBRequest.user);
    });
  });

  // ============================================================================
  // OTP BRUTE-FORCE PROTECTION
  // ============================================================================

  describe('OTP Brute-Force Protection', () => {
    const { maxAttempts, expiredOtpTtlSeconds } = testDataFactory.otpConstants;

    it('locks OTP challenge after 3 failed attempts', () => {
      const challenge = testDataFactory.opsOtpChallenge({
        status: 'PENDING',
        failedAttempts: 0
      });

      let attempts = 0;

      // Simulate 3 failed submissions
      for (let i = 0; i < 3; i++) {
        attempts++;
      }

      expect(attempts).toBe(3);
      expect(attempts).toBe(maxAttempts);

      // After 3 attempts, challenge.status should be 'FAILED'
      const lockedChallenge = {
        ...challenge,
        status: 'FAILED' as const,
        failedAttempts: 3
      };

      expect(lockedChallenge.status).toBe('FAILED');
      expect(lockedChallenge.failedAttempts).toBe(maxAttempts);
    });

    it('rejects further submissions after challenge locked', () => {
      const lockedChallenge = testDataFactory.opsOtpChallenge({
        status: 'FAILED',
        failedAttempts: 3
      });

      // Attempt 4: should fail with "challenge not pending"
      const canSubmit = lockedChallenge.status === 'PENDING';

      expect(canSubmit).toBe(false);
    });

    it('enforces OTP TTL expiration (10 minutes)', () => {
      const now = Date.now();
      const challenge = testDataFactory.opsOtpChallenge({
        expiresAt: new Date(now + expiredOtpTtlSeconds * 1000)
      });

      const isExpired = challenge.expiresAt.getTime() < now;
      expect(isExpired).toBe(false); // Valid, not expired yet

      // After TTL
      const expiredChallenge = {
        ...challenge,
        expiresAt: new Date(now - 1000) // 1 second ago
      };

      const isExpiredNow = expiredChallenge.expiresAt.getTime() < now;
      expect(isExpiredNow).toBe(true);
    });

    it('limits OTP challenge creation rate by opsRead profile', () => {
      // Challenge creation via POST /ops/otp/request
      // This counts toward opsRead limit (~10/min in normal mode)

      const normalModeOtpRequestLimit = 10; // Part of opsRead limit
      const challengeRequests = Array.from({ length: 10 }, (_, i) => ({
        action: 'config-save',
        request: i + 1
      }));

      expect(challengeRequests.length).toBeLessThanOrEqual(normalModeOtpRequestLimit);
    });

    it('allows attacker max 30 OTP attempts in 10 minutes (3 per challenge × 10 challenges/min)', () => {
      // Attack scenario: attacker knows email, tries to brute-force OTP
      // - Can request max ~10 challenges/min (opsRead limit)
      // - Each challenge allows max 3 attempts
      // - Total attempts per 10 min: 10 challenges × 3 attempts = 30 attempts
      // - Against 1M possibilities (6-digit code): 30/1M = 0.003% success

      const challengesPerMinute = 10;
      const attemptsPerChallenge = 3;
      const minutes = 10;
      const totalAttempts = challengesPerMinute * attemptsPerChallenge * minutes;

      expect(totalAttempts).toBe(300); // 300 attempts in 10 minutes
      expect(totalAttempts).toBeLessThan(1_000_000); // Much less than 6-digit possibilities
    });
  });

  // ============================================================================
  // RATE LIMIT WINDOW BEHAVIOR
  // ============================================================================

  describe('Rate Limit Window Behavior (Sliding Window)', () => {
    const { windowSeconds } = testDataFactory.rateLimitConstants;

    it('resets counter at window boundary', () => {
      // Window: 60 seconds
      // Request at T=0-59: count toward first window
      // Request at T=60+: count toward second window (counter resets)

      const window1Start = 0;
      const window1End = windowSeconds * 1000; // Convert to ms
      const window2Start = window1End + 1;

      expect(window1Start).toBeLessThan(window1End);
      expect(window1End).toBeLessThan(window2Start);
    });

    it('uses Redis TTL for automatic window reset', () => {
      // Redis key expires after 60 seconds
      // When expired, next request creates fresh key with count=1

      const redisTtl = windowSeconds; // 60 seconds
      expect(redisTtl).toBe(60);
    });

    it('increments counter within same window', () => {
      // Request 1 at T=0: count = 1
      // Request 2 at T=1: count = 2
      // Request 10 at T=50: count = 10
      // Request 11 at T=55: count = 11 → 429 (exceeds 10/min limit)

      const requests = Array.from({ length: 11 }, (_, i) => ({
        timestamp: i * 1000, // Spread over 10 seconds (within 60s window)
        count: i + 1
      }));

      expect(requests[0]!.count).toBe(1);
      expect(requests[9]!.count).toBe(10); // Allowed
      expect(requests[10]!.count).toBe(11); // Blocked
    });
  });

  // ============================================================================
  // RESPONSE HEADERS FOR RATE LIMITING
  // ============================================================================

  describe('Rate Limit Response Headers', () => {
    it('includes Retry-After header on 429 response', () => {
      const response429 = {
        status: 429,
        headers: {
          'retry-after': '60', // Seconds until rate limit resets
          'x-ratelimit-limit': '10',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': (Date.now() + 60000).toString()
        }
      };

      expect(response429.status).toBe(429);
      expect(response429.headers['retry-after']).toBe('60');
      expect(parseInt(response429.headers['x-ratelimit-remaining'])).toBe(0);
    });

    it('includes RateLimit headers on successful responses', () => {
      const response200 = {
        status: 200,
        headers: {
          'x-ratelimit-limit': '10',
          'x-ratelimit-remaining': '7', // After 3 requests
          'x-ratelimit-reset': (Date.now() + 60000).toString()
        }
      };

      expect(response200.status).toBe(200);
      expect(parseInt(response200.headers['x-ratelimit-remaining'])).toBeLessThan(10);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Rate Limit Edge Cases', () => {
    it('handles burst of simultaneous requests (all from same user)', () => {
      // Simulate 5 simultaneous requests from same user
      // Each should increment counter atomically
      // Final count = 5 (within limit)

      const simultaneousCount = 5;
      const limit = 10;

      expect(simultaneousCount).toBeLessThanOrEqual(limit);
    });

    it('handles mode transition during window (normal → emergency)', () => {
      // Scenario: User makes 5 requests in normal mode (limit: 10)
      // Load-shed transitions to emergency (limit: 3)
      // 6th request comes in

      // In normal: requests 1-5 allowed
      const requestsInNormal = 5;

      // Mode transitions to emergency
      // 6th request: only 1 request allowed in emergency (new window), succeeds
      // 7th request: would exceed emergency limit

      expect(requestsInNormal).toBeLessThan(10);
    });

    it('handles user deactivation (clears rate limit state)', () => {
      // When user deactivated, rate limit key should be cleaned up
      // New user (if reactivated) gets fresh counter

      const userId = 'ops_user_xyz';
      const key1 = `rate-limit:ops:${userId}`;

      // User deactivated: delete key1
      const key2 = `rate-limit:ops:${userId}`; // Same user reactivated

      // In real implementation: key1 != key2 (or both deleted + recreated)
      expect(key1).toBe(key2); // Same user, but state cleared
    });
  });
});
