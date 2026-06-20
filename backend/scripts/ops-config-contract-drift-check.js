#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');
const { ENV_RUNTIME_CONTRACT } = require('./env-runtime-contract.js');

const root = path.resolve(__dirname, '..');
const opsConfigContractPath = path.join(root, 'src', 'modules', 'ops', 'ops-config-contract.ts');

const OPS_CONFIG_CANDIDATE_PREFIXES = [
  'OPS_',
  'NOTIFY_',
  'PAYMENT_',
  'SHIPPING_',
  'RAZORPAY_',
  'DELHIVERY_',
  'SHIPROCKET_',
  'RESEND_',
  'MSG91_',
  'FAST2SMS_'
];

const OPS_CONFIG_CANDIDATE_EXACT = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'INVOICE_STORAGE_ROOT',
  'OPS_DB_ENCRYPTION_KEY',
  'REPLAY_APPROVAL_TOKEN'
]);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function isOpsConfigCandidateKey(key) {
  if (OPS_CONFIG_CANDIDATE_EXACT.has(key)) {
    return true;
  }
  return OPS_CONFIG_CANDIDATE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function parseOpsConfigContract(source) {
  // [\s\S]*? matches across newlines (JS has no single-line /s flag in older engines).
  // This is required because multi-line entries (those with runtimeSource, note, etc.)
  // were silently skipped by the previous [^{}]* pattern.
  const entryRegex = /\{[\s\S]*?key:\s*'([A-Z0-9_]+)'[\s\S]*?mutableViaOps:\s*(true|false)[\s\S]*?\}/g;
  const allKeys = new Set();
  const mutableKeys = new Set();
  let match;
  while ((match = entryRegex.exec(source)) !== null) {
    const key = match[1];
    const mutableViaOps = match[2] === 'true';
    allKeys.add(key);
    if (mutableViaOps) {
      mutableKeys.add(key);
    }
  }
  return { allKeys, mutableKeys };
}

function collectOpsConfigContractDriftErrors(contractSource, envRuntimeContract) {
  const errors = [];
  const { allKeys, mutableKeys } = parseOpsConfigContract(contractSource);

  if (allKeys.size === 0) {
    errors.push('ops-config-contract.ts did not yield any contract keys (parser drift or malformed contract).');
    return errors;
  }

  if (mutableKeys.size === 0) {
    errors.push('ops-config-contract.ts has no mutable keys; ops config API would be effectively disabled.');
  }

  const envKeys = new Set(envRuntimeContract.envExampleRequired.map((entry) => entry.key));
  const candidateEnvKeys = [...envKeys].filter(isOpsConfigCandidateKey);

  for (const key of candidateEnvKeys) {
    if (!allKeys.has(key)) {
      errors.push(`Ops config contract missing candidate env key: ${key}`);
    }
  }

  const EXPECTED_ABSENT_ENV_KEYS = new Set(['SHIPPING_PROVIDER']);

  for (const key of allKeys) {
    if (!envKeys.has(key) && !EXPECTED_ABSENT_ENV_KEYS.has(key)) {
      errors.push(`Ops config contract key is not present in ENV_RUNTIME_CONTRACT.envExampleRequired: ${key}`);
    }
  }

  return errors;
}

function runOpsConfigContractDriftCheck() {
  const contractSource = read(opsConfigContractPath);
  const errors = collectOpsConfigContractDriftErrors(contractSource, ENV_RUNTIME_CONTRACT);

  if (errors.length > 0) {
    logger.error('Ops config contract drift detected:');
    for (const error of errors) {
      logger.error(`- ${error}`);
    }
    process.exit(1);
  }

  logger.success('Ops config contract drift check passed');
}

if (require.main === module) {
  runOpsConfigContractDriftCheck();
}

module.exports = {
  runOpsConfigContractDriftCheck,
  collectOpsConfigContractDriftErrors,
  parseOpsConfigContract,
  isOpsConfigCandidateKey
};
