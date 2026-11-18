import { describe, expect, it } from 'vitest';
import {
  isExistingPickupMessage,
  isPickupNotApplicableMessage,
  payloadIndicatesExistingPickup
} from './pickup-detection';

describe('isExistingPickupMessage', () => {
  it('matches provider phrases for an already-arranged pickup', () => {
    const positives = [
      'Already in Pickup Queue.',
      'Pickup request already exists for this warehouse',
      'open pickup request pending',
      'A pickup is already scheduled for today',
      'duplicate pickup request',
      'pr_exist: true'
    ];
    for (const message of positives) {
      expect(isExistingPickupMessage(message)).toBe(true);
    }
  });

  it('does not match unrelated failures', () => {
    const negatives = [
      'ClientWarehouse matching query does not exist',
      'Invalid shipment id',
      'Insufficient balance',
      'Pincode not serviceable',
      '',
      undefined,
      null,
      42
    ];
    for (const message of negatives) {
      expect(isExistingPickupMessage(message)).toBe(false);
    }
  });
});

describe('payloadIndicatesExistingPickup', () => {
  it('detects the signal across common message/error fields', () => {
    expect(payloadIndicatesExistingPickup({ message: 'Already in Pickup Queue.' })).toBe(true);
    expect(payloadIndicatesExistingPickup({ error: 'open pickup request pending' })).toBe(true);
    expect(payloadIndicatesExistingPickup({ error: ['pickup already exists'] })).toBe(true);
    expect(payloadIndicatesExistingPickup({ rmk: 'duplicate pickup' })).toBe(true);
  });

  it('returns false for a normal success payload', () => {
    expect(payloadIndicatesExistingPickup({ pickup_id: 12345, success: true })).toBe(false);
    expect(payloadIndicatesExistingPickup({ status: 1, pickup_token_number: 'PKP1' })).toBe(false);
  });
});

describe('isPickupNotApplicableMessage', () => {
  it("matches Shiprocket's refusal to raise a new pickup request", () => {
    const positives = [
      'Shiprocket rejected the request (HTTP 400): Invalid Status for pickup generation',
      'invalid status for pickup generation',
      'Pickup is not allowed for this shipment',
      'Cannot generate pickup for this AWB'
    ];
    for (const message of positives) {
      expect(isPickupNotApplicableMessage(message)).toBe(true);
    }
  });

  it('stays distinct from a proven already-scheduled pickup', () => {
    // "Invalid Status for pickup generation" must NOT be read as proof that a
    // pickup exists — that would tick "Pickup scheduled" on an unsubstantiated
    // signal (the shipment may instead be cancelled or already collected).
    expect(isExistingPickupMessage('Invalid Status for pickup generation')).toBe(false);
    expect(isPickupNotApplicableMessage('Already in Pickup Queue.')).toBe(false);
  });

  it('does not match unrelated failures or empty input', () => {
    const negatives = [
      'Invalid order id',
      'Ohh! This AWB has been cancelled.',
      'Request failed with status code 500',
      '',
      '   '
    ];
    for (const message of negatives) {
      expect(isPickupNotApplicableMessage(message)).toBe(false);
    }
    expect(isPickupNotApplicableMessage(null)).toBe(false);
    expect(isPickupNotApplicableMessage(42)).toBe(false);
  });
});
