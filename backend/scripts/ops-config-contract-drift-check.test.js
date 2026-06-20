const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectOpsConfigContractDriftErrors,
  isOpsConfigCandidateKey,
  parseOpsConfigContract,
  runOpsConfigContractDriftCheck
} = require('./ops-config-contract-drift-check.js');

const { ENV_RUNTIME_CONTRACT } = require('./env-runtime-contract.js');

test('ops config contract drift check passes for current repository state', () => {
  assert.doesNotThrow(() => runOpsConfigContractDriftCheck());
});

test('candidate key detection includes ops/payment/shipping/notify families', () => {
  assert.equal(isOpsConfigCandidateKey('OPS_METRICS_TOKEN'), true);
  assert.equal(isOpsConfigCandidateKey('RAZORPAY_KEY_ID'), true);
  assert.equal(isOpsConfigCandidateKey('NOTIFY_EMAIL_ENABLED'), true);
  assert.equal(isOpsConfigCandidateKey('DATABASE_URL'), true);
});

test('collectOpsConfigContractDriftErrors reports missing candidate keys', () => {
  const errors = collectOpsConfigContractDriftErrors("export const X=[{ key: 'PAYMENT_PROVIDER', mutableViaOps: true, requiresRestart: true }];", {
    envExampleRequired: [{ key: 'PAYMENT_PROVIDER' }, { key: 'RAZORPAY_KEY_ID' }]
  });
  assert.equal(errors.some((entry) => entry.includes('missing candidate env key: RAZORPAY_KEY_ID')), true);
});

test('parseOpsConfigContract extracts mutable and non-mutable keys', () => {
  const parsed = parseOpsConfigContract(`
    { key: 'DATABASE_URL', mutableViaOps: false, requiresRestart: true },
    { key: 'PAYMENT_PROVIDER', mutableViaOps: true, requiresRestart: true }
  `);
  assert.equal(parsed.allKeys.has('DATABASE_URL'), true);
  assert.equal(parsed.mutableKeys.has('DATABASE_URL'), false);
  assert.equal(parsed.mutableKeys.has('PAYMENT_PROVIDER'), true);
});

test('ENV_RUNTIME_CONTRACT references remain compatible with parser and candidate policy', () => {
  const envKeys = ENV_RUNTIME_CONTRACT.envExampleRequired.map((entry) => entry.key);
  assert.equal(envKeys.includes('PAYMENT_PROVIDER'), true);
  assert.equal(envKeys.includes('SHIPPING_PROVIDER'), false);
});
