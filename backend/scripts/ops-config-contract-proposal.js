#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const { ENV_RUNTIME_CONTRACT } = require('./env-runtime-contract.js');
const { parseOpsConfigContract, isOpsConfigCandidateKey } = require('./ops-config-contract-drift-check.js');

const root = path.resolve(__dirname, '..');
const opsConfigContractPath = path.join(root, 'src', 'modules', 'ops', 'ops-config-contract.ts');
const SAFETY_BANNER = 'READ-ONLY: This script never writes env files, contract files, database rows, or provider credentials. It only prints suggested snippets for human review.';

const MAYBE_MUTABLE_PATTERNS = [
  'ENABLED',
  'ALLOWLIST',
  'WINDOW',
  'TIMEOUT',
  'FAILOVER',
  'THRESHOLD',
  'COOLDOWN',
  'MAX_',
  'MIN_',
  'BASE_URL',
  'PROVIDER',
  'SECRET',
  'SALT',
  'ENCRYPTION_KEY',
  'JWT',
  'TOKEN',
  'PASSWORD',
  'AUTH_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'INVOICE_STORAGE_ROOT'
];

function parseEnvFileKeys(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const keys = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (/^[A-Z0-9_]+$/.test(key)) {
      keys.push(key);
    }
  }

  return keys;
}

function suggestDomain(key) {
  if (key.startsWith('NOTIFY_') || key.startsWith('EMAIL_') || key.startsWith('SMS_') || key.startsWith('RESEND_') || key.startsWith('MSG91_') || key.startsWith('FAST2SMS_')) {
    return 'notifications';
  }
  if (key.startsWith('PAYMENT_') || key.startsWith('RAZORPAY_')) {
    return 'payments';
  }
  if (key.startsWith('SHIPPING_') || key.startsWith('DELHIVERY_') || key.startsWith('SHIPROCKET_')) {
    return 'shipping';
  }
  if (key.startsWith('OPS_') || key === 'REPLAY_APPROVAL_TOKEN') {
    return 'opsSecurity';
  }
  if (key.startsWith('R2_') || key.startsWith('MEDIA_')) {
    return 'media';
  }
  return 'core';
}

function suggestMutableViaOps(key) {
  if (MAYBE_MUTABLE_PATTERNS.some((pattern) => key.includes(pattern))) {
    return true;
  }
  return false;
}

function keyDescription(key) {
  return key.toLowerCase().split('_').join(' ');
}

function collectCandidateKeys(envFilePaths) {
  const discovered = new Set();

  for (const filePath of envFilePaths) {
    for (const key of parseEnvFileKeys(filePath)) {
      if (isOpsConfigCandidateKey(key)) {
        discovered.add(key);
      }
    }
  }

  if (discovered.size === 0) {
    for (const entry of ENV_RUNTIME_CONTRACT.envExampleRequired) {
      if (isOpsConfigCandidateKey(entry.key)) {
        discovered.add(entry.key);
      }
    }
  }

  return discovered;
}

function collectMissingContractKeys(candidateKeys) {
  const contractSource = fs.readFileSync(opsConfigContractPath, 'utf8');
  const parsed = parseOpsConfigContract(contractSource);

  const missing = [...candidateKeys].filter((key) => !parsed.allKeys.has(key)).sort();

  return { missing, parsed };
}

function groupByDomain(keys) {
  const grouped = {
    core: [],
    payments: [],
    shipping: [],
    notifications: [],
    opsSecurity: []
  };

  for (const key of keys) {
    grouped[suggestDomain(key)].push(key);
  }

  return grouped;
}

function renderProposal(missingKeys) {
  if (missingKeys.length === 0) {
    return [SAFETY_BANNER, '', '✅ No missing ops config contract entries found.'];
  }

  const lines = [];
  const grouped = groupByDomain(missingKeys);

  lines.push(SAFETY_BANNER);
  lines.push('');
  lines.push('⚠️ Proposed ops config contract additions (REVIEW BEFORE APPLYING):');
  lines.push('');
  lines.push('Add under OPS_CONFIG_OVERVIEW_GROUPS items:');

  for (const [domain, keys] of Object.entries(grouped)) {
    if (keys.length === 0) {
      continue;
    }

    lines.push('');
    lines.push(`// domain: ${domain}`);
    for (const key of keys) {
      const mutableViaOps = suggestMutableViaOps(key);
      lines.push(`{ key: '${key}', mutableViaOps: ${mutableViaOps}, requiresRestart: true, note: 'Auto-proposed: ${keyDescription(key)} (reviewed by human).' },`);
    }
  }

  const mutableSuggestions = missingKeys.filter((key) => suggestMutableViaOps(key));
  if (mutableSuggestions.length > 0) {
    lines.push('');
    lines.push('Suggested mutable entries (manual review required):');
    for (const key of mutableSuggestions) {
      lines.push(`- ${key}`);
    }
  }

  lines.push('');
  lines.push('Security reminder: current policy allows contract-listed secrets, salts, tokens, encryption keys, and infra URLs to be ops-editable only after human review.');

  return lines;
}

function runProposal({ envFiles = [] } = {}) {
  const envFilePaths = envFiles.length > 0
    ? envFiles.map((value) => path.resolve(root, value))
    : [path.resolve(root, '.env'), path.resolve(root, '.env.example')];

  const candidateKeys = collectCandidateKeys(envFilePaths);
  const { missing } = collectMissingContractKeys(candidateKeys);

  const lines = renderProposal(missing);
  for (const line of lines) {
    process.stdout.write(line + '\n');
  }

  return { missing, lines };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const envFiles = [];

  if (args.some((arg) => arg === '--apply' || arg === '--write' || arg === '--commit')) {
    logger.error('Unsupported flag provided. This script is read-only and never applies changes automatically');
    process.exit(1);
  }

  for (const arg of args) {
    if (arg.startsWith('--env-file=')) {
      envFiles.push(arg.slice('--env-file='.length));
    }
  }

  runProposal({ envFiles });
}

module.exports = {
  parseEnvFileKeys,
  suggestDomain,
  suggestMutableViaOps,
  collectCandidateKeys,
  collectMissingContractKeys,
  runProposal
};
